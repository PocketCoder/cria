import { createApiClient, type ApiClient } from '@/api/client';
import { getDb, exec } from '@/db';
import { notify } from '@/db/bus';

/**
 * Reconcile deletions by fetching all server IDs for tasks and projects and
 * removing any local rows whose server_id no longer exists on the server.
 * Runs on a longer interval (≈15 min) as per SPEC §7.5.
 */
export async function reconcileDeletions(api: ApiClient = createApiClient()) {
  const db = await getDb();

  // ----- Tasks -----
  const serverTaskIds = new Set<number>();
  let page = 1;
  const PER_PAGE = 200; // larger batch for deletions sweep
  while (true) {
    const { data, response } = await api.GET('/tasks', {
      params: {
        query: {
          // Only fetch IDs to reduce payload
          fields: 'id',
          page,
          per_page: PER_PAGE,
        },
      },
    });
    if (!response.ok) break;
    const batch = data ?? [];
    for (const t of batch) {
      // @ts-ignore – server payload shape may be different, we just need id
      if (t.id) serverTaskIds.add(t.id as number);
    }
    const totalPages = parseInt(response.headers.get('x-pagination-total-pages') ?? '1', 10);
    if (page >= totalPages || batch.length < PER_PAGE) break;
    page++;
  }

  // Delete any local tasks whose server_id is missing
  const localTaskRows = await db.select<any[]>(`SELECT local_id, server_id FROM tasks WHERE server_id IS NOT NULL`);
  for (const row of localTaskRows) {
    if (!serverTaskIds.has(row.server_id)) {
      await exec(
        `DELETE FROM task_relations WHERE task_local_id = ? OR other_task_local_id = ?`,
        [row.local_id, row.local_id],
      );
      await exec(`DELETE FROM tasks WHERE local_id = ?`, [row.local_id]);
    }
  }

  // ----- Projects (similar) -----
  const serverProjectIds = new Set<number>();
  page = 1;
  while (true) {
    const { data, response } = await api.GET('/projects', {
      params: { query: { fields: 'id', page, per_page: PER_PAGE } },
    });
    if (!response.ok) break;
    const batch = data ?? [];
    for (const p of batch) {
      if (p.id) serverProjectIds.add(p.id as number);
    }
    const totalPages = parseInt(response.headers.get('x-pagination-total-pages') ?? '1', 10);
    if (page >= totalPages || batch.length < PER_PAGE) break;
    page++;
  }
  const localProjRows = await db.select<any[]>(`SELECT local_id, server_id FROM projects WHERE server_id IS NOT NULL`);
  for (const row of localProjRows) {
    if (!serverProjectIds.has(row.server_id)) {
      await exec(`DELETE FROM projects WHERE local_id = ?`, [row.local_id]);
    }
  }

  // Notify UI that data may have changed
  notify('tasks');
  notify('projects');
}
