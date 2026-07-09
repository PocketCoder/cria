import { createApiClient, type ApiClient } from '@/api/client';
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
const MAX_PAGES = 200; // safety bound

interface PullResult {
  projects: number;
  views: number;
  buckets: number;
}

/**
 * Pull all projects the user has access to from the server and upsert them
 * locally.
 *
 * Strategy:
 * 1. Page through GET /projects (per_page=50). Vikunja returns
 *    `x-pagination-total-pages` in the response headers.
 * 2. For each batch: validate with Zod, then upsertProjectFromServer.
 * 3. After the first pass, do a re-link pass: any project whose payload
 *    referenced a parent that wasn't synced yet will have parent_local_id
 *    NULL. Re-upserting fixes the link (because by then all parents are
 *    in the local store).
 * 4. Stamp sync_state.projects_synced_at.
 *
 * No conflict resolution here — M1 is read-only sync. M3 will introduce
 * the dirty-aware merge path.
 */
export async function pullAll(
  client: ApiClient = createApiClient(),
): Promise<PullResult> {
  return singleFlight('pullAll', async () => {
  const projects = await pullProjects(client);
  await pullSavedFilters(client);
  const views = await pullAllViews(client);
  const buckets = await pullAllBuckets(client);
  return { projects, views, buckets };
});
}

export async function pullProjects(
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullProjects', async () => {
  const collected: ProjectResponse[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, response } = await client.GET('/projects', {
      params: {
        query: {
          page,
          per_page: PER_PAGE,
          
        },
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`pullProjects: HTTP ${response.status} ${text}`);
    }
    const batch = data ?? [];
    for (const raw of batch) {
      const parsed = projectResponseSchema.safeParse(raw);
      if (parsed.success) {
        // id -1 is the server's Favorites pseudo-project — Cria has its own
        // Favorites smart view. ids < -1 are saved-filter pseudo-projects
        // (kept: they drive the sidebar Filters section, views and buckets).
        if (parsed.data.id === -1) continue;
        collected.push(parsed.data);
      } else {
        console.warn('[pullProjects] skipping invalid project:', parsed.error);
      }
    }

    const totalPages = parseInt(
      response.headers.get('x-pagination-total-pages') ?? '1',
      10,
    );
    if (page >= totalPages || batch.length < PER_PAGE) break;
  }

  // Two-pass upsert so dangling parent links resolve on the second pass.
  for (const p of collected) {
    await upsertProjectFromServer(p);
  }
  for (const p of collected) {
    if (
      typeof p.parent_project_id === 'number' &&
      p.parent_project_id > 0
    ) {
      await upsertProjectFromServer(p);
    }
  }

  await stampSyncState('projects_synced_at');
  return collected.length;
  });
}

/**
 * Pull saved-filter details for every saved-filter pseudo-project already in
 * the local projects table (server_id < -1; filterId = -server_id - 1,
 * mirroring upstream's GetSavedFilterIDFromProjectID). Prunes local filters
 * that no longer have a pseudo-project. Returns the number upserted.
 */
export async function pullSavedFilters(
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullSavedFilters', async () => {
    const db = await getDb();
    const rows = await db.select<{ server_id: number }[]>(
      'SELECT server_id FROM projects WHERE server_id < -1 AND deleted = 0',
    );
    const keep: number[] = [];
    for (const row of rows) {
      const filterId = -row.server_id - 1;
      const { data, response } = await client.GET('/filters/{id}', {
        params: { path: { id: filterId } },
      });
      if (!response.ok || !data) {
        console.warn(`[pullSavedFilters] HTTP ${response.status} for filter ${filterId}`);
        continue;
      }
      await upsertSavedFilterFromServer(data as SavedFilterPayload);
      keep.push(filterId);
    }
    await pruneSavedFilters(keep);
    return keep.length;
  });
}

/**
 * Pull tasks for a single project from GET /tasks, filtered server-side.
 * Returns the number of tasks upserted.
 *
 * The endpoint returns all tasks the user can read; we filter by
 * `project_id = <id>` via the Vikunja filter DSL so the response is small.
 */
export async function pullTasksForProject(
  projectServerId: number,
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullTasksForProject', async () => {
  // Delta filter: only tasks changed since the last sync (see tasksDeltaFilter),
  // composed with the project scope. Null on first sync → full project pull.
  const delta = await tasksDeltaFilter();
  const filter = delta
    ? `project_id = ${projectServerId} && ${delta}`
    : `project_id = ${projectServerId}`;
  const collected: TaskResponse[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, response } = await client.GET('/tasks', {
      params: {
        query: {
          page,
          per_page: PER_PAGE,
          filter,
          // No `expand: 'comments'`: comments inflate every task in the list
          // response but are only shown in the detail card, so we fetch them
          // lazily per-task via pullCommentsForTask when a card opens.
          // No sort_by: `position` is per-view-only and Vikunja returns 400
          // outside a view context. We sort locally in listTasksForProject.
        },
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `pullTasksForProject: HTTP ${response.status} ${text.slice(0, 200)}`,
      );
    }
    const batch = data ?? [];
    for (const raw of batch) {
      const parsed = taskResponseSchema.safeParse(raw);
      if (parsed.success) {
        collected.push(parsed.data);
      } else {
        console.warn('[pullTasksForProject] skipping invalid task:', parsed.error);
      }
    }

    const totalPages = parseInt(
      response.headers.get('x-pagination-total-pages') ?? '1',
      10,
    );
    if (page >= totalPages || batch.length < PER_PAGE) break;
  }

  for (const t of collected) {
    await upsertTaskWithRelations(t);
  }

  // Do NOT stamp tasks_synced_at here. That watermark drives the delta filter
  // for the *cross-project* pullAllTasks ("all tasks up to T are mirrored"). A
  // per-project pull only mirrors one project, so stamping it here would make
  // the next pullAllTasks delta-skip every other project's tasks — the cause of
  // "only the project I opened has tasks; Today/Upcoming/Inbox are empty". Only
  // pullAllTasks may advance the watermark.
  return collected.length;
  });
}

/**
 * Refetch a single task by server id and mirror it (including all
 * embedded relations: labels, assignees, attachments, reminders,
 * related_tasks). Used after a relation push so the inverse row that
 * Vikunja's server auto-creates on the *other* task shows up locally
 * in seconds rather than after the next periodic pull tick.
 *
 * Best-effort: callers should tolerate failure (network blip, 404,
 * permissions changed). We notify('tasks') on success so the UI
 * refreshes; on error we log and return.
 */
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

/**
 * Fetch just the comments for one task and mirror them locally. Called when a
 * task detail card opens, since the list pulls no longer carry comments inline
 * (see pullTasksForProject). Best-effort + silent on failure: the detail card
 * already shows whatever comments are cached locally, so an offline open still
 * works — this only refreshes them. Resolves the server id from the local id;
 * a local-only task (no server id yet) has no server comments to pull.
 */
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

/**
 * Upsert one task payload plus its inline labels + assignees. Shared by
 * the per-project and all-tasks pulls. Silent (no notify) — see the
 * sync-upsert rule in src/db.
 */
async function upsertTaskWithRelations(
  t: TaskResponse,
  // The list endpoints return relations too, but we've seen them come back
  // empty/partial for a task whose peer-side (inverse) relation exists —
  // which would wipe a perfectly good local relation on every poll. So list
  // pulls only *apply* relations they actually carry (never clear), and only
  // an authoritative single-task GET (refetchTaskByServerId) clears missing
  // ones. See #87 and the relation-clobber investigation.
  clearMissingRelations = false,
): Promise<void> {
  const taskLocalId = await upsertTaskFromServer(t);
  if (taskLocalId && Array.isArray(t.labels)) {
    const validLabels: LabelResponse[] = [];
    for (const raw of t.labels) {
      const parsed = labelResponseSchema.safeParse(raw);
      if (parsed.success) validLabels.push(parsed.data);
    }
    await replaceTaskLabelsFromServer(taskLocalId, validLabels);
  }
  if (taskLocalId && Array.isArray(t.assignees)) {
    const validAssignees: AssigneeResponse[] = [];
    for (const raw of t.assignees) {
      const parsed = assigneeResponseSchema.safeParse(raw);
      if (parsed.success) validAssignees.push(parsed.data);
    }
    await upsertTaskAssigneesFromServer(taskLocalId, validAssignees);
  }
  if (taskLocalId && Array.isArray(t.attachments)) {
    const validAttachments: TaskAttachmentResponse[] = [];
    for (const raw of t.attachments) {
      const parsed = taskAttachmentSchema.safeParse(raw);
      if (parsed.success) validAttachments.push(parsed.data);
    }
    await replaceTaskAttachmentsFromServer(taskLocalId, validAttachments);
  }
  if (taskLocalId && Array.isArray(t.reminders)) {
    const validReminders: TaskReminderResponse[] = [];
    for (const raw of t.reminders) {
      const parsed = taskReminderSchema.safeParse(raw);
      if (parsed.success) validReminders.push(parsed.data);
    }
    await replaceTaskRemindersFromServer(taskLocalId, validReminders);
  }
  if (taskLocalId && Array.isArray(t.comments)) {
    const validComments: CommentResponse[] = [];
    for (const raw of t.comments) {
      const parsed = commentResponseSchema.safeParse(raw);
      if (parsed.success) validComments.push(parsed.data);
    }
    await replaceTaskCommentsFromServer(taskLocalId, validComments);
  }
  if (taskLocalId && t.related_tasks && typeof t.related_tasks === 'object') {
    // Vikunja sends related_tasks as { [kind]: Task[] }. Validate each
    // peer through relatedTaskSchema (minimal id/title/done shape); the
    // full task lands separately through the regular task pull, so we
    // don't need every field here.
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
    // List pulls (clearMissingRelations=false) only apply relations they
    // actually return; they must not wipe local relations to empty.
    if (clearMissingRelations || Object.keys(validRelated).length > 0) {
      await replaceTaskRelationsFromServer(taskLocalId, validRelated);
    }
  }
}

/**
 * Pull *every* task the user can read (no project filter), so the smart
 * views (Today / Upcoming / Labels) have cross-project data without the
 * user having to open each project first. Same `GET /tasks` endpoint as
 * pullTasksForProject, just without the `project_id` filter.
 *
 * Closes the M1→M2 "tasks aren't on the periodic pull" gap (#33). Silent,
 * like all sync-path upserts.
 */
export async function pullAllTasks(
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullAllTasks', async () => {
  // Delta filter: only tasks changed since the last sync (see tasksDeltaFilter).
  // Null on first sync → full pull.
  const delta = await tasksDeltaFilter();
  const collected: TaskResponse[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, response } = await client.GET('/tasks', {
      // No `expand: 'comments'` — see pullTasksForProject. The cross-project
      // pull runs every 60s, so dropping inline comments here is the bigger
      // payload/battery win; comments load per-task on detail open.
      params: {
        query: {
          page,
          per_page: PER_PAGE,
          ...(delta ? { filter: delta } : {}),
        },
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `pullAllTasks: HTTP ${response.status} ${text.slice(0, 200)}`,
      );
    }
    const batch = data ?? [];
    for (const raw of batch) {
      const parsed = taskResponseSchema.safeParse(raw);
      if (parsed.success) collected.push(parsed.data);
      else console.warn('[pullAllTasks] skipping invalid task:', parsed.error);
    }
    const totalPages = parseInt(
      response.headers.get('x-pagination-total-pages') ?? '1',
      10,
    );
    if (page >= totalPages || batch.length < PER_PAGE) break;
  }

  for (const t of collected) {
    await upsertTaskWithRelations(t);
  }

  await stampSyncState('tasks_synced_at');
  return collected.length;
  });
}

/**
 * Pull the full label catalogue (Vikunja's /labels endpoint). Run
 * alongside project pulls so any label the user owns but hasn't yet
 * applied to a task still shows up in the local catalogue.
 */
export async function pullLabels(
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullLabels', async () => {
  const collected: LabelResponse[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, response } = await client.GET('/labels', {
      params: { query: { page, per_page: PER_PAGE } },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`pullLabels: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    const batch = data ?? [];
    for (const raw of batch) {
      const parsed = labelResponseSchema.safeParse(raw);
      if (parsed.success) collected.push(parsed.data);
      else console.warn('[pullLabels] skipping invalid label:', parsed.error);
    }
    const totalPages = parseInt(
      response.headers.get('x-pagination-total-pages') ?? '1',
      10,
    );
    if (page >= totalPages || batch.length < PER_PAGE) break;
  }
  for (const l of collected) await upsertLabelFromServer(l);
  await stampSyncState('labels_synced_at');
  return collected.length;
});
}

/**
 * Pull all views for every project that has a server_id.
 * Called after pullProjects so the project table is populated.
 */
export async function pullAllViews(
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight('pullAllViews', async () => {
  const db = await getDb();
  const projectRows = await db.select<{ local_id: string; server_id: number | null }[]>(
    `SELECT local_id, server_id FROM projects WHERE server_id IS NOT NULL AND deleted = 0`,
  );
  let total = 0;
  for (const p of projectRows) {
    if (p.server_id == null) continue;
    total += await pullViewsForProject(p.server_id, p.local_id, client);
  }
  await stampSyncState('views_synced_at');
  return total;
});
}

/**
 * Pull views + (kanban) buckets for one project, resolving the server id
 * from the local id. Used as the on-open refresh in `useProjectViews`
 * (mirrors how `useProjectTasks` calls `pullTasksForProject`). Returns the
 * number of views pulled; 0 for a local-only project (no server id yet).
 */
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

  // Pull buckets for any kanban views we just synced, so the board has its
  // columns the moment the user switches to it.
  const kanbanViews = await db.select<{ local_id: string; server_id: number | null }[]>(
    `SELECT local_id, server_id FROM project_views
      WHERE project_local_id = ? AND view_kind = 'kanban'
        AND deleted = 0 AND server_id IS NOT NULL`,
    [projectLocalId],
  );
  for (const v of kanbanViews) {
    if (v.server_id == null) continue;
    try {
      await pullBucketsForView(projectServerId, v.server_id, v.local_id, client);
    } catch (err) {
      console.warn('[pullViewsForProjectLocal] bucket pull failed:', err);
    }
  }

  return count;
});
}

/**
 * Pull views for a single project from the server and replace the local
 * view list.
 */
export async function pullViewsForProject(
  projectServerId: number,
  projectLocalId: string,
  client: ApiClient = createApiClient(),
): Promise<number> {
  return singleFlight(`pullViewsForProject:${projectLocalId}`, async () => {
  const collected: ViewResponse[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, response } = await (client.GET as any)(
      '/projects/{project}/views',
      {
        params: {
          path: { project: projectServerId },
          query: { page, per_page: PER_PAGE },
        },
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `pullViewsForProject: HTTP ${response.status} ${text.slice(0, 200)}`,
      );
    }
    const batch: unknown[] = data ?? [];
    for (const raw of batch) {
      const parsed = viewResponseSchema.safeParse(raw);
      if (parsed.success) collected.push(parsed.data);
      else console.warn('[pullViewsForProject] skipping invalid view:', parsed.error);
    }

    const totalPages = parseInt(
      response.headers.get('x-pagination-total-pages') ?? '1',
      10,
    );
    if (page >= totalPages || batch.length < PER_PAGE) break;
  }

  await replaceViewsForProjectFromServer(projectLocalId, collected);
  return collected.length;
});
}

/**
 * Pull buckets for every kanban view across all projects.
 */
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
  let total = 0;
  for (const v of views) {
    if (v.server_id == null) continue;
    const projectRows = await db.select<{ server_id: number | null }[]>(
      `SELECT p.server_id
         FROM project_views pv
         JOIN projects p ON p.local_id = pv.project_local_id
        WHERE pv.local_id = ?`,
      [v.local_id],
    );
    const projectServerId = projectRows[0]?.server_id;
    if (projectServerId == null) continue;
    total += await pullBucketsForView(projectServerId, v.server_id, v.local_id, client);
  }
  await stampSyncState('buckets_synced_at');
  return total;
});
}

/**
 * Fetch buckets for a kanban view from the server and replace the local
 * bucket list. Silent — no notify().
 */
async function pullBucketsForView(
  projectServerId: number,
  viewServerId: number,
  viewLocalId: string,
  client: ApiClient = createApiClient(),
): Promise<number> {
  const collected: BucketResponse[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, response } = await (client.GET as any)(
      '/projects/{project}/views/{view}/buckets',
      {
        params: {
          path: { project: projectServerId, view: viewServerId },
          query: { page, per_page: PER_PAGE },
        },
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `pullBucketsForView: HTTP ${response.status} ${text.slice(0, 200)}`,
      );
    }
    const batch: unknown[] = data ?? [];
    for (const raw of batch) {
      const parsed = bucketResponseSchema.safeParse(raw);
      if (parsed.success) collected.push(parsed.data);
      else console.warn('[pullBucketsForView] skipping invalid bucket:', parsed.error);
    }

    const totalPages = parseInt(
      response.headers.get('x-pagination-total-pages') ?? '1',
      10,
    );
    if (page >= totalPages || batch.length < PER_PAGE) break;
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

// Delta-pull high-watermark margin. `tasks_synced_at` is stamped with the
// *client* clock but compared against the server's `updated`, so we subtract an
// overlap before filtering: re-fetching a few already-seen tasks is harmless
// (upserts are idempotent), but missing one — because the client clock ran
// ahead of the server, or a task was updated mid-pull — is not. Server-side
// deletions aren't captured by a delta filter at all; reconcileDeletions (the
// 15-min sweep) is what removes those.
const DELTA_OVERLAP_MS = 5 * 60_000;

async function readSyncState(column: SyncColumn): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<Record<string, string | null>[]>(
    `SELECT ${column} FROM sync_state WHERE id = 1 LIMIT 1`,
  );
  return rows[0]?.[column] ?? null;
}

/**
 * Vikunja filter clause limiting a task pull to rows changed since the last
 * sync (minus DELTA_OVERLAP_MS). Returns null on first sync so the caller does
 * a full pull. Keeps the 60s tick from re-fetching every task every minute.
 */
async function tasksDeltaFilter(): Promise<string | null> {
  const last = await readSyncState('tasks_synced_at');
  if (!last) return null;
  // Self-heal a poisoned watermark. tasks_synced_at can get stamped to "now"
  // by a pull that mirrored *zero* tasks — e.g. an early pull whose tasks were
  // all skipped because their projects hadn't synced yet (see
  // upsertTaskFromServer's project-not-synced skip). After that, a delta filter
  // (`updated > <stamp>`) excludes every pre-existing task forever, so tasks
  // never appear even once projects sync. If we hold a watermark but have no
  // tasks stored, the watermark is provably wrong — do a full pull instead.
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

