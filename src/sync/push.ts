import { createApiClient, callApi, type ApiClient } from '@/api/client';
import { getDb, withTx, exec, type Database } from '@/db';
import { notify, subscribe } from '@/db/bus';
import { ApiError, NetworkError } from '@/api/errors';
import { executeTaskCommentOp } from './push/comment';
import { executeBucketOp, executeTaskBucketOp, executeTaskPositionOp } from './push/kanban';
import { executeLabelOp } from './push/label';
import { executeProjectOp } from './push/project';
import { type OutboxRow } from './push/shared';
import { executeTaskLinkOp, executeTaskOp } from './push/task';
import { executeViewOp } from './push/view';

// Public API kept on this module so importers don't change.
export { taskToBody } from './push/task';
export type { TaskRow } from './push/shared';

/**
 * Subscribe the current user to a task by calling the Vikunja API,
 * then stamp is_subscribed locally without going through the outbox.
 */
export async function subscribeToTask(
  taskServerId: number,
  taskLocalId: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  const now = new Date().toISOString();
  await exec(`UPDATE tasks SET is_subscribed = 1, updated_at = ? WHERE local_id = ?`, [now, taskLocalId]);
  try {
    await callApi(
      client.PUT('/subscriptions/{entity}/{entityID}', {
        params: { path: { entity: 'task', entityID: String(taskServerId) } },
      }),
    );
  } catch (err) {
    await exec(`UPDATE tasks SET is_subscribed = 0, updated_at = ? WHERE local_id = ?`, [now, taskLocalId]);
    throw err;
  }
  notify('tasks');
}

export async function unsubscribeFromTask(
  taskServerId: number,
  taskLocalId: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  const now = new Date().toISOString();
  await exec(`UPDATE tasks SET is_subscribed = 0, updated_at = ? WHERE local_id = ?`, [now, taskLocalId]);
  try {
    await callApi(
      client.DELETE('/subscriptions/{entity}/{entityID}', {
        params: { path: { entity: 'task', entityID: String(taskServerId) } },
      }),
    );
  } catch (err) {
    await exec(`UPDATE tasks SET is_subscribed = 1, updated_at = ? WHERE local_id = ?`, [now, taskLocalId]);
    throw err;
  }
  notify('tasks');
}

const MAX_ATTEMPTS = 10;

/**
 * Drain the outbox: take the oldest eligible row, execute its op against the
 * server, delete it on success, or back off / dead-letter on failure.
 *
 * FIFO per entity. We process one op at a time and stop on first failure
 * so subsequent ops referencing the same entity don't run
 * against a not-yet-existing server row.
 *
 * **Re-entrancy guard.** Concurrent drain calls — common in practice because
 * the bus subscription, the periodic tick, and the manual UI button can all
 * fire at once — would race each other's withTx() calls and trip SQLite's
 * "cannot start a transaction within a transaction". A single in-flight
 * drain is enough; subsequent callers no-op and rely on the running drain
 * to finish their work.
 */
// HMR-safe: pin the guard on globalThis so a module reload doesn't reset
// `false` while a previous module's drain is still in flight.
declare global {
  var __cria_isDraining__: boolean | undefined;
}

export async function drainOutbox(
  client: ApiClient = createApiClient(),
): Promise<void> {
  if (globalThis.__cria_isDraining__) return;
  globalThis.__cria_isDraining__ = true;
  try {
    await drainLoop(client);
  } finally {
    globalThis.__cria_isDraining__ = false;
  }
}

const MAX_OPS_PER_DRAIN = 100;

async function drainLoop(client: ApiClient): Promise<void> {
  const db = await getDb();
  let ops = 0;

  while (ops < MAX_OPS_PER_DRAIN) {
    // Always pick the oldest row regardless of next_attempt_at. If the head
    // row is backing off, stop the drain — skipping it would break FIFO.
    const rows = await db.select<OutboxRow[]>(
      `SELECT * FROM outbox
       ORDER BY id ASC
       LIMIT 1`,
    );
    const op = rows[0];
    if (!op) break;

    // If the head row is backing off, don't skip past it — stop the drain.
    if (op.next_attempt_at && op.next_attempt_at > new Date().toISOString()) {
      break;
    }

    try {
      await executeOp(client, db, op);
      await exec('DELETE FROM outbox WHERE id = ?', [op.id]);
      notify('outbox');
      ops++;
    } catch (err) {
      const isDependency =
        err instanceof ApiError && err.dependency;
      const attempts = isDependency ? op.attempts : op.attempts + 1;
      const retryable =
        err instanceof ApiError
          ? err.retryable
          : err instanceof NetworkError
          ? err.retryable
          : false;

      if (!retryable || (attempts >= MAX_ATTEMPTS && !isDependency)) {
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
        await exec(
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
  if (
    op.entity_type === 'task_label' ||
    op.entity_type === 'task_assignee' ||
    op.entity_type === 'task_relation'
  ) {
    await executeTaskLinkOp(client, db, op);
    return;
  }

  if (op.entity_type === 'project') {
    await executeProjectOp(client, db, op);
    return;
  }

  if (op.entity_type === 'label') {
    await executeLabelOp(client, db, op);
    return;
  }

  if (op.entity_type === 'view') {
    await executeViewOp(client, db, op);
    return;
  }

  if (op.entity_type === 'bucket') {
    await executeBucketOp(client, db, op);
    return;
  }

  if (op.entity_type === 'task_bucket') {
    await executeTaskBucketOp(client, db, op);
    return;
  }

  if (op.entity_type === 'task_position') {
    await executeTaskPositionOp(client, db, op);
    return;
  }

  if (op.entity_type === 'task_comment') {
    await executeTaskCommentOp(client, db, op);
    return;
  }

  if (op.entity_type === 'task') await executeTaskOp(client, db, op);
}

/**
 * Move a dead-lettered operation back into the live outbox so the next
 * drain retries it. Attempts and backoff are reset; the original failure
 * is preserved in `last_error` for context. Returns true if a row was
 * actually re-queued. Callers should trigger a drain afterwards.
 */
export async function retryDeadLetter(id: number): Promise<boolean> {
  const db = await getDb();
  // Read the row before opening the transaction: SELECTs inside withTx go to
  // a separate pooled connection and can't see the in-flight writes.
  const rows = await db.select<
    Array<{
      entity_type: string;
      entity_local_id: string;
      op: string;
      payload: string;
      last_error: string | null;
    }>
  >(`SELECT * FROM outbox_dead_letter WHERE id = ?`, [id]);
  const dl = rows[0];
  if (!dl) return false;

  await withTx(async (tx) => {
    await tx.execute(
      `INSERT INTO outbox
         (entity_type, entity_local_id, op, payload, attempts, last_error, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, 0, ?, NULL, ?)`,
      [
        dl.entity_type,
        dl.entity_local_id,
        dl.op,
        dl.payload,
        dl.last_error,
        new Date().toISOString(),
      ],
    );
    await tx.execute('DELETE FROM outbox_dead_letter WHERE id = ?', [id]);
  });
  notify('outbox');
  return true;
}

/**
 * Discard a single queued op. Removing the head row unblocks the FIFO drain
 * so the rest of the queue can proceed. The local entity stays as-is (it just
 * won't sync via this op), so this is a deliberate, destructive escape hatch
 * for an op that's wedged the queue.
 */
export async function discardOutboxOp(id: number): Promise<void> {
  await exec('DELETE FROM outbox WHERE id = ?', [id]);
  notify('outbox');
}

/** Discard a single dead-lettered op (it already failed permanently). */
export async function discardDeadLetter(id: number): Promise<void> {
  await exec('DELETE FROM outbox_dead_letter WHERE id = ?', [id]);
  notify('outbox');
}

/** Discard every dead-lettered op. */
export async function clearDeadLetters(): Promise<void> {
  await exec('DELETE FROM outbox_dead_letter', []);
  notify('outbox');
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
