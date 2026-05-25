import { createApiClient, type ApiClient } from '@/api/client';
import { upsertProjectFromServer } from '@/db/projects';
import { upsertTaskFromServer } from '@/db/tasks';
import {
  replaceTaskLabelsFromServer,
  upsertLabelFromServer,
} from '@/db/labels';
import { upsertTaskAssigneesFromServer } from '@/db/task-assignees';
import { projectResponseSchema, type ProjectResponse } from '@/domain/project';
import { taskResponseSchema, type TaskResponse } from '@/domain/task';
import { labelResponseSchema, type LabelResponse } from '@/domain/label';
import { assigneeResponseSchema, type AssigneeResponse } from '@/domain/task-assignee';
import { exec } from '@/db';
import { notify } from '@/db/bus';

const PER_PAGE = 50;
const MAX_PAGES = 200; // safety bound

interface PullResult {
  projects: number;
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
  const projects = await pullProjects(client);
  return { projects };
}

export async function pullProjects(
  client: ApiClient = createApiClient(),
): Promise<number> {
  const collected: ProjectResponse[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, response } = await client.GET('/projects', {
      params: {
        query: {
          page,
          per_page: PER_PAGE,
          is_archived: true,
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
  const collected: TaskResponse[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, response } = await client.GET('/tasks', {
      params: {
        query: {
          page,
          per_page: PER_PAGE,
          filter: `project_id = ${projectServerId}`,
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
    const taskLocalId = await upsertTaskFromServer(t);
    if (taskLocalId && Array.isArray(t.labels)) {
      // Each task payload carries its labels inline — route them through
      // the label upsert so the labels table fills in too, then mirror
      // the link set in task_labels.
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
  }

  await stampSyncState('tasks_synced_at');
  return collected.length;
}

/**
 * Pull the full label catalogue (Vikunja's /labels endpoint). Run
 * alongside project pulls so any label the user owns but hasn't yet
 * applied to a task still shows up in the local catalogue.
 */
export async function pullLabels(
  client: ApiClient = createApiClient(),
): Promise<number> {
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
}

async function stampSyncState(
  column: 'projects_synced_at' | 'tasks_synced_at' | 'labels_synced_at',
): Promise<void> {
  const now = new Date().toISOString();
  await exec(`UPDATE sync_state SET ${column} = ? WHERE id = 1`, [now]);
  notify('sync_state');
}

