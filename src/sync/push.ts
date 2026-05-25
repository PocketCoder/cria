import { createApiClient, callApi, type ApiClient } from '@/api/client';
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

interface TaskRow {
  local_id: string;
  server_id: number | null;
  project_local_id: string;
  title: string;
  description: string | null;
  done: number;
  done_at: string | null;
  due_date: string | null;
  start_date: string | null;
  end_date: string | null;
  priority: number;
  percent_done: number;
  hex_color: string | null;
  deleted: number;
}

const MAX_ATTEMPTS = 10;

/**
 * Drain the outbox: take the oldest eligible row, execute its op against the
 * server, delete it on success, or back off / dead-letter on failure.
 *
 * FIFO per entity. We process one op at a time and stop on first failure
 * (per SPEC §7.1) so subsequent ops referencing the same entity don't run
 * against a not-yet-existing server row.
 *
 * **Re-entrancy guard.** Concurrent drain calls — common in practice because
 * the bus subscription, the periodic tick, and the manual UI button can all
 * fire at once — would race each other's withTx() calls and trip SQLite's
 * "cannot start a transaction within a transaction". A single in-flight
 * drain is enough; subsequent callers no-op and rely on the running drain
 * to finish their work.
 */
let isDraining = false;

export async function drainOutbox(
  client: ApiClient = createApiClient(),
): Promise<void> {
  if (isDraining) return;
  isDraining = true;
  try {
    await drainLoop(client);
  } finally {
    isDraining = false;
  }
}

async function drainLoop(client: ApiClient): Promise<void> {
  const db = await getDb();

  while (true) {
    const rows = await db.select<OutboxRow[]>(
      `SELECT * FROM outbox
       WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
       ORDER BY id ASC
       LIMIT 1`,
      [new Date().toISOString()],
    );
    const op = rows[0];
    if (!op) break;

    try {
      await executeOp(client, db, op);
      await db.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
      notify('outbox');
    } catch (err) {
      const attempts = op.attempts + 1;
      const retryable =
        err instanceof ApiError
          ? err.retryable
          : err instanceof NetworkError
          ? err.retryable
          : false;

      if (!retryable || attempts >= MAX_ATTEMPTS) {
        await withTx(async (tx) => {
          await tx.execute(
            `INSERT INTO outbox_dead_letter
               (entity_type, entity_local_id, op, payload, attempts, last_error, failed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              op.entity_type,
              op.entity_local_id,
              op.op,
              op.payload,
              attempts,
              String(err),
              new Date().toISOString(),
            ],
          );
          await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
        });
        notify('outbox');
      } else {
        const delay = Math.min(60_000, 2 ** attempts * 1000);
        const nextAttempt = new Date(Date.now() + delay).toISOString();
        await db.execute(
          `UPDATE outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`,
          [attempts, String(err), nextAttempt, op.id],
        );
      }
      break; // preserve FIFO across retries
    }
  }
}

async function executeOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  if (op.entity_type !== 'task') return;

  const localId = op.entity_local_id;
  const taskRows = await db.select<TaskRow[]>(
    `SELECT local_id, server_id, project_local_id, title, description, done,
            done_at, due_date, start_date, end_date, priority, percent_done,
            hex_color, deleted
       FROM tasks WHERE local_id = ? LIMIT 1`,
    [localId],
  );
  const task = taskRows[0];
  if (!task) return; // permanently gone; nothing to do

  if (op.op === 'create') {
    if (task.deleted === 1) {
      await withTx(async (tx) => {
        await tx.execute('DELETE FROM tasks WHERE local_id = ?', [localId]);
      });
      notify('tasks');
      return;
    }
    if (task.server_id !== null) return; // already created

    const projectRows = await db.select<ProjectLookup[]>(
      `SELECT server_id FROM projects WHERE local_id = ? LIMIT 1`,
      [task.project_local_id],
    );
    const projectServerId = projectRows[0]?.server_id;
    if (!projectServerId) {
      throw new ApiError(408, null, 'Project not yet synced', true);
    }

    const res = await callApi(
      client.PUT('/projects/{id}/tasks', {
        params: { path: { id: projectServerId } },
        body: taskToBody(task),
      }),
    );
    const newServerId = (res as { id?: number }).id;
    const newUpdated = (res as { updated?: string }).updated;

    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE tasks SET server_id = ?, synced_at = ?, dirty = 0, updated_at = ?
         WHERE local_id = ?`,
        [
          newServerId ?? null,
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
        ],
      );
    });
    notify('tasks');
    return;
  }

  if (op.op === 'update') {
    if (task.deleted === 1) return; // delete op will handle it
    if (task.server_id === null) {
      throw new ApiError(408, null, 'Cannot update a task without server id', true);
    }

    const res = await callApi(
      client.POST('/tasks/{id}', {
        params: { path: { id: task.server_id } },
        body: taskToBody(task),
      }),
    );
    const newUpdated = (res as { updated?: string }).updated;

    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE tasks SET synced_at = ?, dirty = 0, updated_at = ?
         WHERE local_id = ?`,
        [
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
        ],
      );
    });
    notify('tasks');
    return;
  }

  if (op.op === 'delete') {
    if (task.server_id === null) {
      // never synced — just drop locally
      await withTx(async (tx) => {
        await tx.execute('DELETE FROM tasks WHERE local_id = ?', [localId]);
      });
      notify('tasks');
      return;
    }
    await callApi(
      client.DELETE('/tasks/{id}', {
        params: { path: { id: task.server_id } },
      }),
    );
    await withTx(async (tx) => {
      await tx.execute('DELETE FROM tasks WHERE local_id = ?', [localId]);
    });
    notify('tasks');
  }
}

function taskToBody(task: TaskRow) {
  return {
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
}

/**
 * Subscribes to the outbox bus topic and the browser 'online' event so the
 * drain loop fires whenever new work is queued or the network comes back.
 * Returns an unsubscribe function — call it on app shutdown.
 */
export function startOutboxSync(): () => void {
  let active = true;
  const trigger = () => {
    if (active) void drainOutbox();
  };
  const unsubOutbox = subscribe('outbox', trigger);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', trigger);
  }
  return () => {
    active = false;
    unsubOutbox();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', trigger);
    }
  };
}
