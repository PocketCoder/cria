import { getDb, withTx } from './index';
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

/** Task→assignee-user-id map across every task, for the global Assignee
 * filter on smart views. Empty arrays are simply absent from the map. */
export async function listAllTaskAssignees(): Promise<Map<string, number[]>> {
  const db = await getDb();
  const rows = await db.select<AssigneeRow[]>(
    `SELECT task_local_id, user_server_id, username, deleted
       FROM task_assignees
      WHERE deleted = 0`,
  );
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const arr = map.get(r.task_local_id) ?? [];
    arr.push(r.user_server_id);
    map.set(r.task_local_id, arr);
  }
  return map;
}

export async function upsertTaskAssigneesFromServer(
  taskLocalId: string,
  assignees: AssigneeResponse[],
): Promise<void> {
  const now = new Date().toISOString();

  await withTx(async (tx) => {
    const [{ dirty } = { dirty: 0 }] = await tx.select<{ dirty: number }[]>(
      `SELECT dirty FROM tasks WHERE local_id = ? LIMIT 1`,
      [taskLocalId],
    );
    if (dirty === 1) return;

    // Read pending outbox ops for task_assignee so we don't wipe
    // an assignee the user just added before the push lands.
    const ops = await tx.select<{ entity_local_id: string; op: string; payload: string }[]>(
      `SELECT entity_local_id, op, payload FROM outbox
        WHERE entity_type = 'task_assignee' ORDER BY id ASC`,
    );
    const preserve = new Set<number>();
    const exclude = new Set<number>();
    for (const o of ops) {
      if (o.entity_local_id !== taskLocalId) continue;
      let payload: { userServerId?: number };
      try {
        payload = JSON.parse(o.payload);
      } catch {
        continue;
      }
      if (typeof payload.userServerId !== 'number') continue;
      if (o.op === 'add') {
        preserve.add(payload.userServerId);
        exclude.delete(payload.userServerId);
      } else if (o.op === 'remove') {
        exclude.add(payload.userServerId);
        preserve.delete(payload.userServerId);
      }
    }

    await tx.execute(`DELETE FROM task_assignees WHERE task_local_id = ?`, [taskLocalId]);

    const inserted = new Set<number>();
    for (const a of assignees) {
      const userServerId = a.id;
      if (exclude.has(userServerId)) continue;
      const username = a.username ?? a.name ?? null;
      await tx.execute(
        `INSERT INTO task_assignees
           (task_local_id, user_server_id, username, updated_at, synced_at, dirty, deleted)
         VALUES (?, ?, ?, ?, ?, 0, 0)`,
        [taskLocalId, userServerId, username, now, now],
      );
      inserted.add(userServerId);
    }

    // Re-insert preserved pending-add assignees the server didn't include.
    for (const userServerId of preserve) {
      if (inserted.has(userServerId)) continue;
      await tx.execute(
        `INSERT INTO task_assignees
           (task_local_id, user_server_id, username, updated_at, synced_at, dirty, deleted)
         VALUES (?, ?, NULL, ?, ?, 0, 0)`,
        [taskLocalId, userServerId, now, now],
      );
    }
  });
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
