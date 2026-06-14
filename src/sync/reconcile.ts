import { createApiClient, type ApiClient } from '@/api/client';
import { getDb, exec } from '@/db';
import { notify } from '@/db/bus';

const PER_PAGE = 50;

async function fetchAllServerIds(
  api: ApiClient,
  path: '/tasks' | '/projects',
): Promise<Set<number>> {
  const ids = new Set<number>();
  let page = 1;

  while (true) {
    const { data, response } = await api.GET(path, {
      params: {
        query: { fields: 'id', page, per_page: PER_PAGE },
      },
    });
    if (!response.ok) {
      throw new Error(
        `reconcileDeletions: ${path} HTTP ${response.status} on page ${page}`,
      );
    }
    const batch = data ?? [];
    for (const item of batch) {
      if (typeof (item as { id?: unknown }).id === 'number') {
        ids.add((item as { id: number }).id);
      }
    }

    const totalPagesRaw = response.headers.get('x-pagination-total-pages');
    if (totalPagesRaw !== null) {
      const totalPages = parseInt(totalPagesRaw, 10);
      if (page >= totalPages) break;
    } else if (batch.length < PER_PAGE) {
      break;
    }

    page++;
  }

  return ids;
}

async function deleteTaskCascade(localId: string): Promise<void> {
  await exec('DELETE FROM task_labels WHERE task_local_id = ?', [localId]);
  await exec('DELETE FROM task_buckets WHERE task_local_id = ?', [localId]);
  await exec('DELETE FROM task_reminders WHERE task_local_id = ?', [localId]);
  await exec('DELETE FROM task_assignees WHERE task_local_id = ?', [localId]);
  await exec(
    'DELETE FROM task_relations WHERE task_local_id = ? OR other_task_local_id = ?',
    [localId, localId],
  );
  await exec('DELETE FROM tasks WHERE local_id = ?', [localId]);
}

export async function reconcileDeletions(api: ApiClient = createApiClient()) {
  const db = await getDb();

  // ----- Tasks -----
  const serverTaskIds = await fetchAllServerIds(api, '/tasks');

  const localTaskRows = await db.select<
    { local_id: string; server_id: number; dirty: number }[]
  >(
    `SELECT local_id, server_id, dirty FROM tasks WHERE server_id IS NOT NULL`,
  );
  for (const row of localTaskRows) {
    if (!serverTaskIds.has(row.server_id)) {
      if (row.dirty === 1) continue;
      await deleteTaskCascade(row.local_id);
    }
  }

  // ----- Projects -----
  const serverProjectIds = await fetchAllServerIds(api, '/projects');

  const localProjRows = await db.select<
    { local_id: string; server_id: number; dirty: number }[]
  >(
    `SELECT local_id, server_id, dirty FROM projects WHERE server_id IS NOT NULL`,
  );
  for (const row of localProjRows) {
    if (!serverProjectIds.has(row.server_id)) {
      if (row.dirty === 1) continue;
      const childTasks = await db.select<{ local_id: string }[]>(
        `SELECT local_id FROM tasks WHERE project_local_id = ?`,
        [row.local_id],
      );
      for (const t of childTasks) {
        await deleteTaskCascade(t.local_id);
      }
      await exec('DELETE FROM projects WHERE local_id = ?', [row.local_id]);
    }
  }

  notify('tasks');
  notify('projects');
}
