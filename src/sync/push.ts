import { createApiClient, callApi, type ApiClient } from '@/api/client';
import { getDb, withTx, exec, type Database } from '@/db';
import { notify, subscribe } from '@/db/bus';
import { ApiError, NetworkError } from '@/api/errors';

/**
 * Subscribe the current user to a task by calling the Vikunja API,
 * then stamp is_subscribed locally without going through the outbox.
 */
export async function subscribeToTask(
  taskServerId: number,
  taskLocalId: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.PUT('/subscriptions/{entity}/{entityID}', {
      params: { path: { entity: 'task', entityID: String(taskServerId) } },
    }),
  );
  await exec(
    `UPDATE tasks SET is_subscribed = 1, updated_at = ? WHERE local_id = ?`,
    [new Date().toISOString(), taskLocalId],
  );
  notify('tasks');
}

/**
 * Unsubscribe the current user from a task.
 */
export async function unsubscribeFromTask(
  taskServerId: number,
  taskLocalId: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.DELETE('/subscriptions/{entity}/{entityID}', {
      params: { path: { entity: 'task', entityID: String(taskServerId) } },
    }),
  );
  await exec(
    `UPDATE tasks SET is_subscribed = 0, updated_at = ? WHERE local_id = ?`,
    [new Date().toISOString(), taskLocalId],
  );
  notify('tasks');
}

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

export interface TaskRow {
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
  is_favorite: number;
  repeat_after: number;
  repeat_mode: number;
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
// HMR-safe: pin the guard on globalThis so a module reload doesn't reset
// `false` while a previous module's drain is still in flight.
declare global {
  // eslint-disable-next-line no-var
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
      await exec('DELETE FROM outbox WHERE id = ?', [op.id]);
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
        await exec(
          `UPDATE outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`,
          [attempts, String(err), nextAttempt, op.id],
        );
      }
      break; // preserve FIFO across retries
    }
  }
}

interface LabelLookup {
  server_id: number | null;
}

async function executeOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  if (op.entity_type === 'task_label') {
    const payload = JSON.parse(op.payload);
    const labelLocalId: string = payload.labelLocalId;

    const [taskRow] = await db.select<TaskRow[]>(
      `SELECT server_id FROM tasks WHERE local_id = ? LIMIT 1`,
      [op.entity_local_id],
    );
    const [labelRow] = await db.select<LabelLookup[]>(
      `SELECT server_id FROM labels WHERE local_id = ? LIMIT 1`,
      [labelLocalId],
    );
    const taskServerId = taskRow?.server_id;
    const labelServerId = labelRow?.server_id;
    if (!taskServerId || !labelServerId) return;

    if (op.op === 'add') {
      await callApi(
        client.PUT('/tasks/{task}/labels', {
          params: { path: { task: taskServerId } },
          body: { label_id: labelServerId },
        }),
      );
    } else if (op.op === 'remove') {
      await callApi(
        client.DELETE('/tasks/{task}/labels/{label}', {
          params: { path: { task: taskServerId, label: labelServerId } },
        }),
      );
    }
    return;
  }

  if (op.entity_type === 'task_assignee') {
    const payload = JSON.parse(op.payload);
    const userServerId: number = payload.userServerId;

    const [taskRow] = await db.select<TaskRow[]>(
      `SELECT server_id FROM tasks WHERE local_id = ? LIMIT 1`,
      [op.entity_local_id],
    );
    const taskServerId = taskRow?.server_id;
    if (!taskServerId) return;

    if (op.op === 'add') {
      await callApi(
        client.PUT('/tasks/{taskID}/assignees', {
          params: { path: { taskID: taskServerId } },
          body: { user_id: userServerId },
        }),
      );
    } else if (op.op === 'remove') {
      await callApi(
        client.DELETE('/tasks/{taskID}/assignees/{userID}', {
          params: { path: { taskID: taskServerId, userID: userServerId } },
        }),
      );
    }
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

  if (op.entity_type !== 'task') return;

  const localId = op.entity_local_id;
    const taskRows = await db.select<TaskRow[]>(
      `SELECT local_id, server_id, project_local_id, title, description, done,
              done_at, due_date, start_date, end_date, priority, percent_done,
              hex_color, is_favorite, repeat_after, repeat_mode, deleted
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
        body: taskToBody(task, projectServerId),
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

      const [projRow] = await db.select<ProjectLookup[]>(
        `SELECT server_id FROM projects WHERE local_id = ? LIMIT 1`,
        [task.project_local_id],
      );

      // The local task_reminders table is the source of truth for this
      // task's reminders; send the current set (possibly empty) so adds
      // and clears both propagate.
      const reminderRows = await db.select<{ reminder_at: string }[]>(
        `SELECT reminder_at FROM task_reminders WHERE task_local_id = ?`,
        [localId],
      );
      const reminders = reminderRows.map((r) => ({ reminder: r.reminder_at }));

      const res = await callApi(
        client.POST('/tasks/{id}', {
          params: { path: { id: task.server_id } },
          body: taskToBody(task, projRow?.server_id ?? undefined, reminders),
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

export function taskToBody(
  task: TaskRow,
  projectServerId?: number,
  reminders?: { reminder: string }[],
) {
  return {
    title: task.title,
    ...(projectServerId != null ? { project_id: projectServerId } : {}),
    description: task.description ?? undefined,
    done: task.done === 1,
    due_date: task.due_date ?? undefined,
    start_date: task.start_date ?? undefined,
    end_date: task.end_date ?? undefined,
    priority: task.priority,
    percent_done: task.percent_done <= 1
      ? Math.round(task.percent_done * 100)
      : Math.round(task.percent_done),
    hex_color: (task.hex_color ?? '').replace(/^#/, '') || undefined,
    is_favorite: task.is_favorite === 1 ? true : false,
    repeat_after: task.repeat_after ?? undefined,
    repeat_mode: task.repeat_mode != null ? (task.repeat_mode as 0 | 1 | 2) : undefined,
    // Reminders are a task field in Vikunja (no separate endpoint), so a
    // reminder change rides the task update. Sent whenever provided —
    // including an empty array, so clearing all reminders propagates.
    ...(reminders ? { reminders } : {}),
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

/* ───────────────────────────── project ops ─────────────────────────── */

interface ProjectRow {
  local_id: string;
  server_id: number | null;
  title: string;
  description: string | null;
  parent_local_id: string | null;
  hex_color: string | null;
  is_archived: number;
  deleted: number;
}

async function executeProjectOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  const localId = op.entity_local_id;
  const [row] = await db.select<ProjectRow[]>(
    `SELECT local_id, server_id, title, description, parent_local_id,
            hex_color, is_archived, deleted
       FROM projects WHERE local_id = ? LIMIT 1`,
    [localId],
  );
  if (!row) return;

  if (op.op === 'create') {
    if (row.deleted === 1) {
      await withTx(async (tx) => {
        await tx.execute('DELETE FROM projects WHERE local_id = ?', [localId]);
      });
      notify('projects');
      return;
    }
    if (row.server_id !== null) return;
    const res = await callApi(
      client.PUT('/projects', { body: await projectBodyWithParent(row) }),
    );
    const newServerId = (res as { id?: number }).id;
    const newUpdated = (res as { updated?: string }).updated;
    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE projects SET server_id = ?, synced_at = ?, dirty = 0, updated_at = ?
         WHERE local_id = ?`,
        [
          newServerId ?? null,
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
        ],
      );
    });
    notify('projects');
    return;
  }

  if (op.op === 'update') {
    if (row.deleted === 1) return;
    if (row.server_id === null) {
      throw new ApiError(408, null, 'Cannot update a project without server id', true);
    }
    const res = await callApi(
      client.POST('/projects/{id}', {
        params: { path: { id: row.server_id } },
        body: await projectBodyWithParent(row),
      }),
    );
    const newUpdated = (res as { updated?: string }).updated;
    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE projects SET synced_at = ?, dirty = 0, updated_at = ?
         WHERE local_id = ?`,
        [
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
        ],
      );
    });
    notify('projects');
    return;
  }

  if (op.op === 'delete') {
    if (row.server_id === null) {
      await withTx(async (tx) => {
        await tx.execute('DELETE FROM projects WHERE local_id = ?', [localId]);
      });
      notify('projects');
      return;
    }
    await callApi(
      client.DELETE('/projects/{id}', {
        params: { path: { id: row.server_id } },
      }),
    );
    await withTx(async (tx) => {
      await tx.execute('DELETE FROM tasks WHERE project_local_id = ?', [localId]);
      await tx.execute('DELETE FROM projects WHERE local_id = ?', [localId]);
    });
    notify('projects');
    notify('tasks');
  }
}

async function resolveParentServerId(
  parentLocalId: string | null,
): Promise<number | null> {
  if (!parentLocalId) return null;
  const db = await getDb();
  const [row] = await db.select<{ server_id: number | null }[]>(
    `SELECT server_id FROM projects WHERE local_id = ? LIMIT 1`,
    [parentLocalId],
  );
  return row?.server_id ?? null;
}

function projectBody(row: ProjectRow): Record<string, unknown> {
  return {
    title: row.title,
    description: row.description ?? undefined,
    hex_color: row.hex_color ? row.hex_color.replace(/^#/, '') : undefined,
    is_archived: row.is_archived === 1,
    parent_project_id: undefined as number | undefined,
  };
}

async function projectBodyWithParent(row: ProjectRow): Promise<Record<string, unknown>> {
  const body = projectBody(row);
  body.parent_project_id =
    (await resolveParentServerId(row.parent_local_id)) ?? undefined;
  return body;
}

/* ───────────────────────────── label ops ─────────────────────────── */

interface LabelRow {
  local_id: string;
  server_id: number | null;
  title: string;
  description: string | null;
  hex_color: string | null;
  deleted: number;
}

async function executeLabelOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  const localId = op.entity_local_id;
  const [row] = await db.select<LabelRow[]>(
    `SELECT local_id, server_id, title, description, hex_color, deleted
       FROM labels WHERE local_id = ? LIMIT 1`,
    [localId],
  );
  if (!row) return;

  if (op.op === 'create') {
    if (row.deleted === 1) {
      await withTx(async (tx) => {
        await tx.execute('DELETE FROM labels WHERE local_id = ?', [localId]);
      });
      notify('labels');
      return;
    }
    if (row.server_id !== null) return;
    const res = await callApi(
      client.PUT('/labels', { body: labelBody(row) }),
    );
    const newServerId = (res as { id?: number }).id;
    const newUpdated = (res as { updated?: string }).updated;
    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE labels SET server_id = ?, synced_at = ?, dirty = 0, updated_at = ?
         WHERE local_id = ?`,
        [
          newServerId ?? null,
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
        ],
      );
    });
    notify('labels');
    return;
  }

  if (op.op === 'update') {
    if (row.deleted === 1) return;
    if (row.server_id === null) {
      throw new ApiError(408, null, 'Cannot update a label without server id', true);
    }
    const res = await callApi(
      client.PUT('/labels/{id}', {
        params: { path: { id: row.server_id } },
        body: labelBody(row),
      }),
    );
    const newUpdated = (res as { updated?: string }).updated;
    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE labels SET synced_at = ?, dirty = 0, updated_at = ?
         WHERE local_id = ?`,
        [
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
        ],
      );
    });
    notify('labels');
    return;
  }

  if (op.op === 'delete') {
    if (row.server_id === null) {
      await withTx(async (tx) => {
        await tx.execute('DELETE FROM labels WHERE local_id = ?', [localId]);
      });
      notify('labels');
      return;
    }
    await callApi(
      client.DELETE('/labels/{id}', {
        params: { path: { id: row.server_id } },
      }),
    );
    await withTx(async (tx) => {
      await tx.execute('DELETE FROM task_labels WHERE label_local_id = ?', [localId]);
      await tx.execute('DELETE FROM labels WHERE local_id = ?', [localId]);
    });
    notify('labels');
    notify('task_labels');
  }
}

function labelBody(row: LabelRow): Record<string, unknown> {
  return {
    title: row.title,
    description: row.description ?? undefined,
    hex_color: row.hex_color ? row.hex_color.replace(/^#/, '') : undefined,
  };
}
