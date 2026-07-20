import { createApiClient, type ApiClient } from '@/api/client';
import { buildApiError } from '@/api/errors';
import { upsertProjectFromServer } from '@/db/projects';
import { upsertTaskFromServer } from '@/db/tasks';
import {
  replaceTaskLabelsFromServer,
  upsertLabelFromServer,
} from '@/db/labels';
import { upsertTaskAssigneesFromServer } from '@/db/task-assignees';
import { replaceTaskAttachmentsFromServer } from '@/db/attachments';
import { replaceTaskRemindersFromServer } from '@/db/reminders';
import { replaceTaskCommentsFromServer } from '@/db/comments';
import { replaceTaskRelationsFromServer } from '@/db/relations';
import { replaceViewsForProjectFromServer } from '@/db/views';
import {
  upsertSavedFilterFromServer,
  pruneSavedFilters,
  type SavedFilterPayload,
} from '@/db/savedFilters';
import { replaceBucketsForViewFromServer } from '@/db/buckets';
import { projectResponseSchema, type ProjectResponse } from '@/domain/project';
import {
  taskResponseSchema,
  taskAttachmentSchema,
  taskReminderSchema,
  relatedTaskSchema,
  type TaskResponse,
  type TaskAttachmentResponse,
  type TaskReminderResponse,
  type RelatedTaskResponse,
} from '@/domain/task';
import { labelResponseSchema, type LabelResponse } from '@/domain/label';
import { commentResponseSchema, type CommentResponse } from '@/domain/comment';
import { assigneeResponseSchema, type AssigneeResponse } from '@/domain/task-assignee';
import { viewResponseSchema, type ViewResponse } from '@/domain/view';
import { bucketResponseSchema, type BucketResponse } from '@/domain/bucket';
import { exec, getDb, singleFlight } from '@/db';
import { notify } from '@/db/bus';

const PER_PAGE = 50;
const MAX_PAGES = 200;

interface PageResult<T> {
  items: T[];
  totalPages: number;
}

async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<PageResult<T>>,
): Promise<T[]> {
  const first = await fetchPage(1);
  const maxPages = Math.min(Math.max(first.totalPages, 1), MAX_PAGES);
  if (maxPages <= 1) return first.items;
  const rest = await Promise.all(
    Array.from({ length: maxPages - 1 }, (_, i) => fetchPage(i + 2)),
  );
  return [first.items, ...rest.map(r => r.items)].flat();
}

export async function pullProjects(
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullProjects', async () => {
  const allRaw = await fetchAllPages(async (page) => {
    const { data, error, response } = await client.GET('/projects', {
      params: { query: { page, per_page: PER_PAGE } },
    });
    if (!response.ok) {
      throw new Error(`pullProjects: HTTP ${response.status} ${buildApiError(response.status, error).message}`);
    }
    return {
      items: data ?? [],
      totalPages: parseInt(response.headers.get('x-pagination-total-pages') ?? '1', 10),
    };
  });

  const collected: ProjectResponse[] = [];
  for (const raw of allRaw) {
    const parsed = projectResponseSchema.safeParse(raw);
    if (parsed.success) {
      if (parsed.data.id === -1) continue;
      collected.push(parsed.data);
    } else {
      console.warn('[pullProjects] skipping invalid project:', parsed.error);
    }
  }

  for (const p of collected) {
    await upsertProjectFromServer(p);
  }
  for (const p of collected) {
    if (typeof p.parent_project_id === 'number' && p.parent_project_id > 0) {
      await upsertProjectFromServer(p);
    }
  }

  await stampSyncState('projects_synced_at');
  return collected.length;
  });
}

export async function pullSavedFilters(
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullSavedFilters', async () => {
    const db = await getDb();
    const rows = await db.select<{ server_id: number }[]>(
      'SELECT server_id FROM projects WHERE server_id < -1 AND deleted = 0',
    );
    const keep: number[] = [];
    let removedStale = false;
    for (const row of rows) {
      const filterId = -row.server_id - 1;
      const { data, response } = await client.GET('/filters/{id}', {
        params: { path: { id: filterId } },
      });
      if (response.status === 404) {
        console.warn(`[pullSavedFilters] filter ${filterId} gone — removing stale pseudo-project`);
        await db.execute('DELETE FROM projects WHERE server_id = ?', [row.server_id]);
        removedStale = true;
        continue;
      }
      if (!response.ok || !data) {
        console.warn(`[pullSavedFilters] HTTP ${response.status} for filter ${filterId}`);
        continue;
      }
      await upsertSavedFilterFromServer(data as SavedFilterPayload);
      keep.push(filterId);
    }
    await pruneSavedFilters(keep);
    if (removedStale) notify('projects');
    return keep.length;
  });
}

export async function pullTasksForProject(
  projectServerId: number,
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullTasksForProject', async () => {
  const delta = await tasksDeltaFilter();
  const filter = delta
    ? `project_id = ${projectServerId} && ${delta}`
    : `project_id = ${projectServerId}`;

  const allRaw = await fetchAllPages(async (page) => {
    const { data, error, response } = await client.GET('/tasks', {
      params: { query: { page, per_page: PER_PAGE, filter } },
    });
    if (!response.ok) {
      throw new Error(`pullTasksForProject: HTTP ${response.status} ${buildApiError(response.status, error).message}`);
    }
    return {
      items: data ?? [],
      totalPages: parseInt(response.headers.get('x-pagination-total-pages') ?? '1', 10),
    };
  });

  const collected: TaskResponse[] = [];
  for (const raw of allRaw) {
    const parsed = taskResponseSchema.safeParse(raw);
    if (parsed.success) {
      collected.push(parsed.data);
    } else {
      console.warn('[pullTasksForProject] skipping invalid task:', parsed.error);
    }
  }

  for (const t of collected) {
    await upsertTaskWithRelations(t);
  }

  return collected.length;
  });
}

export async function refetchTaskByServerId(
  taskServerId: number,
  client: ApiClient = createApiClient(),
): Promise<void> {
  try {
    const { data, response } = await client.GET('/tasks/{id}', {
      params: { path: { id: taskServerId }, query: { expand: 'comments' } },
    });
    if (!response.ok || !data) return;
    const parsed = taskResponseSchema.safeParse(data);
    if (!parsed.success) {
      console.warn('[refetchTaskByServerId] invalid response:', parsed.error);
      return;
    }
    await upsertTaskWithRelations(parsed.data, true);
    notify('tasks');
  } catch (err) {
    console.warn('[refetchTaskByServerId] failed:', err);
  }
}

export async function pullCommentsForTask(
  taskLocalId: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  try {
    const db = await getDb();
    const rows = await db.select<{ server_id: number | null }[]>(
      `SELECT server_id FROM tasks WHERE local_id = ? AND deleted = 0 LIMIT 1`,
      [taskLocalId],
    );
    const serverId = rows[0]?.server_id;
    if (serverId == null) return;
    const { data, response } = await client.GET('/tasks/{id}', {
      params: { path: { id: serverId }, query: { expand: 'comments' } },
    });
    if (!response.ok || !data) return;
    const parsed = taskResponseSchema.safeParse(data);
    if (!parsed.success || !Array.isArray(parsed.data.comments)) return;
    const valid: CommentResponse[] = [];
    for (const raw of parsed.data.comments) {
      const p = commentResponseSchema.safeParse(raw);
      if (p.success) valid.push(p.data);
    }
    await replaceTaskCommentsFromServer(taskLocalId, valid);
  } catch (err) {
    console.warn('[pullCommentsForTask] failed:', err);
  }
}

async function upsertTaskWithRelations(
  t: TaskResponse,
  clearMissingRelations = false,
): Promise<void> {
  const taskLocalId = await upsertTaskFromServer(t);
  if (!taskLocalId) return;

  const ops: Promise<void>[] = [];

  if (Array.isArray(t.labels)) {
    const validLabels: LabelResponse[] = [];
    for (const raw of t.labels) {
      const parsed = labelResponseSchema.safeParse(raw);
      if (parsed.success) validLabels.push(parsed.data);
    }
    if (validLabels.length > 0) ops.push(replaceTaskLabelsFromServer(taskLocalId, validLabels));
  }
  if (Array.isArray(t.assignees)) {
    const validAssignees: AssigneeResponse[] = [];
    for (const raw of t.assignees) {
      const parsed = assigneeResponseSchema.safeParse(raw);
      if (parsed.success) validAssignees.push(parsed.data);
    }
    if (validAssignees.length > 0) ops.push(upsertTaskAssigneesFromServer(taskLocalId, validAssignees));
  }
  if (Array.isArray(t.attachments)) {
    const validAttachments: TaskAttachmentResponse[] = [];
    for (const raw of t.attachments) {
      const parsed = taskAttachmentSchema.safeParse(raw);
      if (parsed.success) validAttachments.push(parsed.data);
    }
    if (validAttachments.length > 0) ops.push(replaceTaskAttachmentsFromServer(taskLocalId, validAttachments));
  }
  if (Array.isArray(t.reminders)) {
    const validReminders: TaskReminderResponse[] = [];
    for (const raw of t.reminders) {
      const parsed = taskReminderSchema.safeParse(raw);
      if (parsed.success) validReminders.push(parsed.data);
    }
    if (validReminders.length > 0) ops.push(replaceTaskRemindersFromServer(taskLocalId, validReminders));
  }
  if (Array.isArray(t.comments)) {
    const validComments: CommentResponse[] = [];
    for (const raw of t.comments) {
      const parsed = commentResponseSchema.safeParse(raw);
      if (parsed.success) validComments.push(parsed.data);
    }
    if (validComments.length > 0) ops.push(replaceTaskCommentsFromServer(taskLocalId, validComments));
  }
  if (t.related_tasks && typeof t.related_tasks === 'object') {
    const validRelated: Record<string, RelatedTaskResponse[]> = {};
    for (const [kind, peers] of Object.entries(t.related_tasks)) {
      if (!Array.isArray(peers)) continue;
      const validPeers: RelatedTaskResponse[] = [];
      for (const raw of peers) {
        const parsed = relatedTaskSchema.safeParse(raw);
        if (parsed.success) validPeers.push(parsed.data);
      }
      if (validPeers.length > 0) validRelated[kind] = validPeers;
    }
    if (clearMissingRelations || Object.keys(validRelated).length > 0) {
      ops.push(replaceTaskRelationsFromServer(taskLocalId, validRelated));
    }
  }

  if (ops.length > 0) await Promise.all(ops);
}

export async function pullAllTasks(
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullAllTasks', async () => {
  const delta = await tasksDeltaFilter();

  const allRaw = await fetchAllPages(async (page) => {
    const { data, error, response } = await client.GET('/tasks', {
      params: {
        query: {
          page,
          per_page: PER_PAGE,
          ...(delta ? { filter: delta } : {}),
        },
      },
    });
    if (!response.ok) {
      throw new Error(`pullAllTasks: HTTP ${response.status} ${buildApiError(response.status, error).message}`);
    }
    return {
      items: data ?? [],
      totalPages: parseInt(response.headers.get('x-pagination-total-pages') ?? '1', 10),
    };
  });

  const collected: TaskResponse[] = [];
  for (const raw of allRaw) {
    const parsed = taskResponseSchema.safeParse(raw);
    if (parsed.success) collected.push(parsed.data);
    else console.warn('[pullAllTasks] skipping invalid task:', parsed.error);
  }

  for (const t of collected) {
    await upsertTaskWithRelations(t);
  }

  await stampSyncState('tasks_synced_at');
  return collected.length;
  });
}

export async function pullLabels(
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullLabels', async () => {
  const allRaw = await fetchAllPages(async (page) => {
    const { data, error, response } = await client.GET('/labels', {
      params: { query: { page, per_page: PER_PAGE } },
    });
    if (!response.ok) {
      throw new Error(`pullLabels: HTTP ${response.status} ${buildApiError(response.status, error).message}`);
    }
    return {
      items: data ?? [],
      totalPages: parseInt(response.headers.get('x-pagination-total-pages') ?? '1', 10),
    };
  });

  const collected: LabelResponse[] = [];
  for (const raw of allRaw) {
    const parsed = labelResponseSchema.safeParse(raw);
    if (parsed.success) collected.push(parsed.data);
    else console.warn('[pullLabels] skipping invalid label:', parsed.error);
  }
  for (const l of collected) await upsertLabelFromServer(l);
  await stampSyncState('labels_synced_at');
  return collected.length;
});
}

export async function pullAllViews(
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullAllViews', async () => {
  const db = await getDb();
  const projectRows = await db.select<{ local_id: string; server_id: number | null }[]>(
    `SELECT local_id, server_id FROM projects WHERE server_id IS NOT NULL AND deleted = 0`,
  );
  const results = await Promise.all(
    projectRows
      .filter((p): p is { local_id: string; server_id: number } => p.server_id != null)
      .map((p) => pullViewsForProject(p.server_id, p.local_id, client)
        .catch((err) => {
          console.warn(`[pullAllViews] skipping project ${p.server_id}:`, err);
          return 0;
        })
      ),
  );
  const total = results.reduce((a, b) => a + b, 0);
  await stampSyncState('views_synced_at');
  return total;
});
}

export async function pullViewsForProjectLocal(
  projectLocalId: string,
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight(`pullViewsForProjectLocal:${projectLocalId}`, async () => {
  const db = await getDb();
  const rows = await db.select<{ server_id: number | null }[]>(
    `SELECT server_id FROM projects WHERE local_id = ? AND deleted = 0 LIMIT 1`,
    [projectLocalId],
  );
  const projectServerId = rows[0]?.server_id;
  if (projectServerId == null) return 0;

  const count = await pullViewsForProject(projectServerId, projectLocalId, client);

  const kanbanViews = await db.select<{ local_id: string; server_id: number | null }[]>(
    `SELECT local_id, server_id FROM project_views
      WHERE project_local_id = ? AND view_kind = 'kanban'
        AND deleted = 0 AND server_id IS NOT NULL`,
    [projectLocalId],
  );
  await Promise.all(
    kanbanViews
      .filter((v): v is { local_id: string; server_id: number } => v.server_id != null)
      .map((v) => pullBucketsForView(projectServerId, v.server_id, v.local_id, client)
        .catch((err) => {
          console.warn('[pullViewsForProjectLocal] bucket pull failed:', err);
          return 0;
        })
      ),
  );

  return count;
});
}

export async function pullViewsForProject(
  projectServerId: number,
  projectLocalId: string,
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight(`pullViewsForProject:${projectLocalId}`, async () => {
  const allRaw = await fetchAllPages(async (page) => {
    const { data, error, response } = await (client.GET as any)(
      '/projects/{project}/views',
      {
        params: {
          path: { project: projectServerId },
          query: { page, per_page: PER_PAGE },
        },
      },
    );
    if (!response.ok) {
      throw new Error(`pullViewsForProject: HTTP ${response.status} ${buildApiError(response.status, error).message}`);
    }
    return {
      items: (data ?? []) as unknown[],
      totalPages: parseInt(response.headers.get('x-pagination-total-pages') ?? '1', 10),
    };
  });

  const collected: ViewResponse[] = [];
  for (const raw of allRaw) {
    const parsed = viewResponseSchema.safeParse(raw);
    if (parsed.success) collected.push(parsed.data);
    else console.warn('[pullViewsForProject] skipping invalid view:', parsed.error);
  }

  await replaceViewsForProjectFromServer(projectLocalId, collected);
  return collected.length;
});
}

export async function pullAllBuckets(
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullAllBuckets', async () => {
  const db = await getDb();
  const views = await db.select<{ local_id: string; server_id: number | null }[]>(
    `SELECT pv.local_id, pv.server_id
       FROM project_views pv
       JOIN projects p ON p.local_id = pv.project_local_id
      WHERE pv.view_kind = 'kanban'
        AND pv.deleted = 0
        AND pv.server_id IS NOT NULL
        AND p.server_id IS NOT NULL`,
  );
  const results = await Promise.all(
    views
      .filter((v): v is { local_id: string; server_id: number } => v.server_id != null)
      .map(async (v) => {
        const projectRows = await db.select<{ server_id: number | null }[]>(
          `SELECT p.server_id
             FROM project_views pv
             JOIN projects p ON p.local_id = pv.project_local_id
            WHERE pv.local_id = ?`,
          [v.local_id],
        );
        const projectServerId = projectRows[0]?.server_id;
        if (projectServerId == null) return 0;
        try {
          return await pullBucketsForView(projectServerId, v.server_id, v.local_id, client);
        } catch (err) {
          console.warn('[pullAllBuckets] bucket pull failed:', err);
          return 0;
        }
      }),
  );
  const total = results.reduce((a, b) => a + b, 0);
  await stampSyncState('buckets_synced_at');
  return total;
});
}

async function pullBucketsForView(
  projectServerId: number,
  viewServerId: number,
  viewLocalId: string,
  client: ApiClient = createApiClient(),
): Promise<number> {
  const allRaw = await fetchAllPages(async (page) => {
    const { data, error, response } = await (client.GET as any)(
      '/projects/{project}/views/{view}/buckets',
      {
        params: {
          path: { project: projectServerId, view: viewServerId },
          query: { page, per_page: PER_PAGE },
        },
      },
    );
    if (!response.ok) {
      throw new Error(`pullBucketsForView: HTTP ${response.status} ${buildApiError(response.status, error).message}`);
    }
    return {
      items: (data ?? []) as unknown[],
      totalPages: parseInt(response.headers.get('x-pagination-total-pages') ?? '1', 10),
    };
  });

  const collected: BucketResponse[] = [];
  for (const raw of allRaw) {
    const parsed = bucketResponseSchema.safeParse(raw);
    if (parsed.success) collected.push(parsed.data);
    else console.warn('[pullBucketsForView] skipping invalid bucket:', parsed.error);
  }

  await replaceBucketsForViewFromServer(viewLocalId, collected);
  return collected.length;
}

type SyncColumn =
  | 'projects_synced_at'
  | 'tasks_synced_at'
  | 'labels_synced_at'
  | 'views_synced_at'
  | 'buckets_synced_at';

const DELTA_OVERLAP_MS = 5 * 60_000;

async function readSyncState(column: SyncColumn): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, string | null>[]>(
    `SELECT ${column} FROM sync_state WHERE id = 1 LIMIT 1`,
  );
  return rows[0]?.[column] ?? null;
}

async function tasksDeltaFilter(): Promise<string | null> {
  const last = await readSyncState('tasks_synced_at');
  if (!last) return null;
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM tasks WHERE deleted = 0`,
  );
  if ((rows[0]?.n ?? 0) === 0) return null;
  const ms = Date.parse(last);
  if (Number.isNaN(ms)) return `updated > '${last}'`;
  const since = new Date(ms - DELTA_OVERLAP_MS).toISOString();
  return `updated > '${since}'`;
}

async function stampSyncState(column: SyncColumn): Promise<void> {
  const now = new Date().toISOString();
  await exec(`UPDATE sync_state SET ${column} = ? WHERE id = 1`, [now]);
  notify('sync_state');
}
