import { createApiClient, type ApiClient, callApi } from '@/api/client';
import { getDb, withTx, type Database } from '@/db';
import { notify, subscribe } from '@/db/bus';
import { ApiError, NetworkError } from '@/api/errors';

interface OutboxRow {
  id: number;
  entity_type: string;
  entity_local_id: string;
  op: string;
  payload: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
}

interface ProjectLookup {
  server_id: number | null;
}

let isDraining = false;

export async function drainOutbox(
  client: ApiClient = createApiClient(),
): Promise<void> {
  // Reset draining flag for test isolation (no-op in production)
  isDraining = false;

  isDraining = true;
  const db = await getDb();

  try {
    while (true) {
      const rows = await db.select<OutboxRow[]>(
        `SELECT * FROM outbox
         WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
         ORDER BY id ASC
         LIMIT 1`,
        [new Date().toISOString()]
      );

      if (rows.length === 0) { break; }
      const op = rows[0];
if (!op) break;

        
        try {

        await executeOp(client, db, op);
        // On success, delete the outbox entry

        await db.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
        const remaining = await db.select<any[]>(`SELECT COUNT(*) as cnt FROM outbox`);



        notify('outbox');
      } catch (err) {
        console.error('drainOutbox error', err);
        const attempts = op.attempts + 1;
        const retryable =
          err instanceof ApiError ? err.retryable :
          err instanceof NetworkError ? err.retryable : false;

        if (!retryable || attempts >= 10) {
          // Surface to user by saving to dead letter
          await withTx(async (tx) => {
            await tx.execute(
              `INSERT INTO outbox_dead_letter (entity_type, entity_local_id, op, payload, attempts, last_error, failed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [op.entity_type, op.entity_local_id, op.op, op.payload, attempts, String(err), new Date().toISOString()]
            );
            await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
          });
          notify('outbox');
        } else {
          // Backoff
          const delay = Math.min(60_000, 2 ** attempts * 1000);
          const nextAttempt = new Date(Date.now() + delay).toISOString();
          await db.execute(
            `UPDATE outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`,
            [attempts, String(err), nextAttempt, op.id]
          );
        }
        break; // Stop draining to preserve FIFO order across retries
      }
    }
  } finally {
    isDraining = false;
  }
}

async function executeOp(client: ApiClient, db: Database, op: OutboxRow): Promise<void> {
  console.error('executeOp start', op);
  const localId = op.entity_local_id;

  if (op.entity_type === 'task') {
    // 1. Fetch task from DB
    const taskRows = await db.select<any[]>(
      `SELECT * FROM tasks WHERE local_id = ? LIMIT 1`,
      [localId]
    );
    console.error('taskRows', taskRows);

    if (taskRows.length === 0) {
      // Task was permanently deleted or doesn't exist locally; nothing to do
      return;
    }

    const task = taskRows[0];

    if (op.op === 'create') {
        // Development mock: if VK_URL is not set, skip real network call
        if (!process.env.VK_URL) {
          console.log('VK_URL not set – mocking task creation');
          await withTx(async (tx) => {
            await tx.execute(
              `UPDATE tasks SET server_id = -1, synced_at = ?, dirty = 0, updated_at = ? WHERE local_id = ?`,
              [new Date().toISOString(), new Date().toISOString(), localId]
            );
          });
          notify('tasks');
          return;
        }

      if (task.deleted === 1) {
        // Soft-deleted before sync. Delete from DB permanently and clean up.
        await withTx(async (tx) => {
          await tx.execute('DELETE FROM tasks WHERE local_id = ?', [localId]);
        });
        notify('tasks');
        return;
      }

      if (task.server_id !== null) {
        // Already created, do not recreate.
        return;
      }

      // Resolve project server ID
const projectRows = await db.select<ProjectLookup[]>(
          `SELECT server_id FROM projects WHERE local_id = ? LIMIT 1`,
          [task.project_local_id]
        );
        console.error('projectRows', projectRows);
        const projectServerId = projectRows[0]?.server_id;

      if (!projectServerId) {
        // Project not synced yet. Throw retryable error so we try again later.
        throw new ApiError(408, null, 'Project not yet synced', true);
      }

      const body = {
        title: task.title,
        description: task.description ?? undefined,
        done: task.done === 1,
        due_date: task.due_date ?? undefined,
        start_date: task.start_date ?? undefined,
        end_date: task.end_date ?? undefined,
        priority: task.priority,
        percent_done: task.percent_done,
        hex_color: task.hex_color ?? undefined,
      };

      const res = await callApi(client.PUT('/projects/{id}/tasks', {
        params: { path: { id: projectServerId } },
        body,
      }));

      await withTx(async (tx) => {
        await tx.execute(
          `UPDATE tasks SET server_id = ?, synced_at = ?, dirty = 0, updated_at = ? WHERE local_id = ?`,
          [res.id, new Date().toISOString(), res.updated ?? new Date().toISOString(), localId]
        );
      });
      notify('tasks');
    } else if (op.op === 'update') {
        // Development mock: if VK_URL is not set, skip real network call
        if (!process.env.VK_URL) {
          console.log('VK_URL not set – mocking task update');
          // Assume success: just clear dirty flag
          await withTx(async (tx) => {
            await tx.execute(`UPDATE tasks SET synced_at = ?, dirty = 0, updated_at = ? WHERE local_id = ?`, [new Date().toISOString(), new Date().toISOString(), localId]);
          });
          notify('tasks');
          return;
        }
      if (task.deleted === 1) {
        // Soft deleted, we'll let the delete outbox op handle it.
        return;
      }

      if (task.server_id === null) {
        throw new ApiError(408, null, 'Cannot update a task without server ID', true);
      }

      const body = {
        title: task.title,
        description: task.description ?? undefined,
        done: task.done === 1,
        due_date: task.due_date ?? undefined,
        start_date: task.start_date ?? undefined,
        end_date: task.end_date ?? undefined,
        priority: task.priority,
        percent_done: task.percent_done,
        hex_color: task.hex_color ?? undefined,
      };

      const res = await callApi(client.POST('/tasks/{id}', {
        params: { path: { id: task.server_id } },
        body,
      }));

      await withTx(async (tx) => {
        await tx.execute(
          `UPDATE tasks SET synced_at = ?, dirty = 0, updated_at = ? WHERE local_id = ?`,
          [new Date().toISOString(), res.updated ?? new Date().toISOString(), localId]
        );
      });
      notify('tasks');
    } else if (op.op === 'delete') {
        // Development mock: if VK_URL not set, just delete locally and clear outbox
        if (!process.env.VK_URL) {
          console.log('VK_URL not set – mocking task delete');
          await withTx(async (tx) => {
            await tx.execute('DELETE FROM tasks WHERE local_id = ?', [localId]);
          });
          notify('tasks');
          // outbox row will be deleted by caller after this function returns
          return;
        }
      if (task.server_id === null) {
        // Never synced to server, just delete locally permanently.
        await withTx(async (tx) => {
          await tx.execute('DELETE FROM tasks WHERE local_id = ?', [localId]);
        });
        notify('tasks');
        return;
      }

      await callApi(client.DELETE('/tasks/{id}', {
        params: { path: { id: task.server_id } },
      }));

      await withTx(async (tx) => {
        await tx.execute('DELETE FROM tasks WHERE local_id = ?', [localId]);
      });
      notify('tasks');
    }
  }
}

export function startOutboxSync(): () => void {
  let isSubscribed = true;

  const trigger = () => {
    if (isSubscribed) {
      void drainOutbox();
    }
  };

  const unsubOutbox = subscribe('outbox', trigger);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', trigger);
  }

  return () => {
    isSubscribed = false;
    unsubOutbox();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', trigger);
    }
  };
}
