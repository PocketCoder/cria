import { getDb, exec, withTx } from './index';
import { notify } from './bus';
import type { TaskAssignee, AssigneeResponse } from '@/domain/task-assignee';

interface AssigneeRow {
  task_local_id: string;
  user_server_id: number;
  username: string | null;
  deleted: number;
}

function rowToAssignee(row: AssigneeRow): TaskAssignee {
  return {
    taskLocalId: row.task_local_id,
    userServerId: row.user_server_id,
    username: row.username,
  };
}

export async function listAssigneesForTask(
  taskLocalId: string,
): Promise<TaskAssignee[]> {
  const db = await getDb();
  const rows = await db.select<AssigneeRow[]>(
    `SELECT task_local_id, user_server_id, username, deleted
       FROM task_assignees
      WHERE task_local_id = ?
        AND deleted = 0
   ORDER BY username ASC`,
    [taskLocalId],
  );
  return rows.map(rowToAssignee);
}

export async function upsertTaskAssigneesFromServer(
  taskLocalId: string,
  assignees: AssigneeResponse[],
): Promise<void> {
  const now = new Date().toISOString();

  await exec(`DELETE FROM task_assignees WHERE task_local_id = ?`, [taskLocalId]);

  for (const a of assignees) {
    const userServerId = a.id;
    const username = a.username ?? a.name ?? null;
    await exec(
      `INSERT INTO task_assignees
         (task_local_id, user_server_id, username, updated_at, synced_at, dirty, deleted)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
      [taskLocalId, userServerId, username, now, now],
    );
  }
}

export async function addTaskAssignee(
  taskLocalId: string,
  userServerId: number,
  username?: string,
): Promise<void> {
  const now = new Date().toISOString();

  const db = await getDb();
  const existing = await db.select<AssigneeRow[]>(
    `SELECT task_local_id, user_server_id, username, deleted
       FROM task_assignees
      WHERE task_local_id = ? AND user_server_id = ? LIMIT 1`,
    [taskLocalId, userServerId],
  );

  if (existing.length > 0 && existing[0]!.deleted === 0) return;

  await withTx(async (tx) => {
    if (existing.length > 0) {
      await tx.execute(
        `UPDATE task_assignees SET deleted = 0, dirty = 1, updated_at = ?, username = ?
         WHERE task_local_id = ? AND user_server_id = ?`,
        [now, username ?? null, taskLocalId, userServerId],
      );
    } else {
      await tx.execute(
        `INSERT INTO task_assignees (task_local_id, user_server_id, username, updated_at, dirty, deleted)
         VALUES (?, ?, ?, ?, 1, 0)`,
        [taskLocalId, userServerId, username ?? null, now],
      );
    }

    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task_assignee', ?, 'add', ?, ?)`,
      [taskLocalId, JSON.stringify({ userServerId, username }), now],
    );
  });

  notify('task_assignees');
  notify('outbox');
}

export async function removeTaskAssignee(
  taskLocalId: string,
  userServerId: number,
): Promise<void> {
  const now = new Date().toISOString();

  await withTx(async (tx) => {
    await tx.execute(
      `UPDATE task_assignees SET deleted = 1, dirty = 1, updated_at = ?
       WHERE task_local_id = ? AND user_server_id = ?`,
      [now, taskLocalId, userServerId],
    );

    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task_assignee', ?, 'remove', ?, ?)`,
      [taskLocalId, JSON.stringify({ userServerId }), now],
    );
  });

  notify('task_assignees');
  notify('outbox');
}
