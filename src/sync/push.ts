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
  updated_at: string;
  deleted: number;
}

const TASK_CONFLICT_FIELDS = [
  'title',
  'description',
  'done',
  'due_date',
  'start_date',
  'end_date',
  'priority',
  'percent_done',
  'hex_color',
  'position',
] as const;

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

interface LabelLookup {
  server_id: number | null;
}

/* ──────── crash-idempotency helpers ──────────── */

/* ──────── entity dispatch ──────────────────── */

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
    if (!taskServerId || !labelServerId) {
      const missing = taskServerId ? 'label' : 'task';
      throw new ApiError(408, null, `task_label: ${missing} has no server id`, true, true);
    }

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
    if (!taskServerId) {
      throw new ApiError(408, null, 'task_assignee: task has no server id', true, true);
    }

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

  if (op.entity_type === 'task_relation') {
    // Payload shape:
    //   add    → { otherTaskLocalId, kind }
    //   remove → { otherTaskLocalId | null, otherTaskServerId | null, kind }
    // For remove the row may have only the carried server id (peer task
    // hadn't synced when the row was mirrored), so we accept either side.
    const payload = JSON.parse(op.payload);
    const kind: string = payload.kind;

    const [taskRow] = await db.select<TaskRow[]>(
      `SELECT server_id FROM tasks WHERE local_id = ? LIMIT 1`,
      [op.entity_local_id],
    );
    const taskServerId = taskRow?.server_id;
    if (!taskServerId) {
      // Owning task isn't synced yet — retry once its 'create' op lands.
      throw new ApiError(408, null, 'task_relation: owning task has no server id', true, true);
    }

    // Resolve the peer's server id. Prefer the local lookup; fall back
    // to a carried value from `remove` payloads where we only had the
    // server id at the time the row was mirrored.
    let otherServerId: number | null =
      typeof payload.otherTaskServerId === 'number' ? payload.otherTaskServerId : null;
    if (!otherServerId && payload.otherTaskLocalId) {
      const [otherRow] = await db.select<TaskRow[]>(
        `SELECT server_id FROM tasks WHERE local_id = ? LIMIT 1`,
        [payload.otherTaskLocalId],
      );
      otherServerId = otherRow?.server_id ?? null;
    }
    if (!otherServerId) {
      // Peer task isn't synced yet — retryable; once it's created the
      // local id resolves to a server id and this op can run.
      throw new ApiError(408, null, 'task_relation: peer task has no server id', true, true);
    }

    if (op.op === 'add') {
      await callApi(
        client.PUT('/tasks/{taskID}/relations', {
          params: { path: { taskID: taskServerId } },
          body: {
            task_id: taskServerId,
            other_task_id: otherServerId,
            // Vikunja's openapi spec types relation_kind as an enum; cast
            // through unknown because our string union is the source of
            // truth and the spec's enum is just the same set of literals.
            relation_kind: kind as unknown as undefined,
          },
        }),
      );
    } else if (op.op === 'remove') {
      await callApi(
        client.DELETE('/tasks/{taskID}/relations/{relationKind}/{otherTaskID}', {
          params: {
            path: {
              taskID: taskServerId,
              relationKind: kind,
              otherTaskID: otherServerId,
            },
          },
          // The DELETE endpoint declares a body but doesn't actually
          // require its contents — server reads the path params. An
          // empty object keeps the openapi client happy.
          body: {},
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

  if (op.entity_type !== 'task') return;

  const localId = op.entity_local_id;
    const taskRows = await db.select<TaskRow[]>(
      `SELECT local_id, server_id, project_local_id, title, description, done,
              done_at, due_date, start_date, end_date, priority, percent_done,
              hex_color, is_favorite, repeat_after, repeat_mode, updated_at, deleted
         FROM tasks WHERE local_id = ? LIMIT 1`,
      [localId],
    );
  const task = taskRows[0];
  if (!task) return; // permanently gone; nothing to do

  if (op.op === 'create') {
    if (task.deleted === 1) {
      await withTx(async (tx) => {
        await tx.execute(
          'DELETE FROM task_relations WHERE task_local_id = ? OR other_task_local_id = ?',
          [localId, localId],
        );
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
      throw new ApiError(408, null, 'Project not yet synced', true, true);
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
         WHERE local_id = ? AND updated_at = ?`,
        [
          newServerId ?? null,
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
          task.updated_at,
        ],
      );
    });
    notify('tasks');
    return;
  }

    if (op.op === 'update') {
      if (task.deleted === 1) return; // delete op will handle it
      if (task.server_id === null) {
        throw new ApiError(408, null, 'Cannot update a task without server id', true, true);
      }

      const [projRow] = await db.select<ProjectLookup[]>(
        `SELECT server_id FROM projects WHERE local_id = ? LIMIT 1`,
        [task.project_local_id],
      );

      // The local task_reminders table is the source of truth for this
      // task's reminders; send the current set (possibly empty) so adds
      // and clears both propagate. Each row carries either an absolute
      // `reminder` (column NOT NULL on absolute rows) or a relative
      // pair (`relative_period` + `relative_to`) or both — we forward
      // whatever's present and let Vikunja resolve.
      const reminderRows = await db.select<{
        reminder_at: string | null;
        relative_period: number | null;
        relative_to: string | null;
      }[]>(
        `SELECT reminder_at, relative_period, relative_to
           FROM task_reminders WHERE task_local_id = ?`,
        [localId],
      );
      const reminders = reminderRows.map((r) => ({
        reminder: r.reminder_at ?? undefined,
        relative_period: r.relative_period ?? undefined,
        relative_to: (r.relative_to ?? undefined) as
          | 'due_date'
          | 'start_date'
          | 'end_date'
          | undefined,
      }));

      // Pre-push divergence check: fetch current server state and compare
      // against our last_synced snapshot to avoid silent overwrites.
      const [lastSyncedRow] = await db.select<{ last_synced: string | null }[]>(
        `SELECT last_synced FROM tasks WHERE local_id = ? LIMIT 1`,
        [localId],
      );
      if (lastSyncedRow?.last_synced) {
        try {
          const serverPayload = await callApi(
            client.GET('/tasks/{id}', { params: { path: { id: task.server_id } } }),
          ) as Record<string, unknown> | undefined;
          if (serverPayload) {
            const conflicted = await checkDivergence(
              lastSyncedRow.last_synced,
              serverPayload,
              TASK_CONFLICT_FIELDS as unknown as readonly string[],
              'task',
              localId,
            );
            if (conflicted) return;
          }
        } catch {
          // GET failed (network, 404, etc.) — skip divergence check and
          // proceed with push; the push itself may fail and retry.
        }
      }

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
         WHERE local_id = ? AND updated_at = ?`,
        [
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
          task.updated_at,
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
        await tx.execute(
          'DELETE FROM task_relations WHERE task_local_id = ? OR other_task_local_id = ?',
          [localId, localId],
        );
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
      await tx.execute(
        'DELETE FROM task_relations WHERE task_local_id = ? OR other_task_local_id = ?',
        [localId, localId],
      );
      await tx.execute('DELETE FROM tasks WHERE local_id = ?', [localId]);
    });
    notify('tasks');
  }
}

/**
 * Vikunja requires full ISO 8601 datetime with timezone offset for all
 * date fields (due_date, start_date, end_date). The local DB may store
 * date-only strings (e.g. "2026-06-09") when set from a date picker;
 * normalise to midnight local time so the server accepts the value.
 */
function normaliseDateForServer(date: string | null | undefined): string | undefined {
  if (!date) return undefined;
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(date)) return date;
  // Date-only — append midnight local time as full ISO offset
  const d = new Date(`${date}T00:00:00`);
  const pad = (n: number) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absMin = Math.abs(offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`;
}

export function taskToBody(
  task: TaskRow,
  projectServerId?: number,
  reminders?: {
    reminder?: string;
    relative_period?: number;
    relative_to?: 'due_date' | 'start_date' | 'end_date';
  }[],
) {
  return {
    title: task.title,
    ...(projectServerId != null ? { project_id: projectServerId } : {}),
    description: task.description ?? undefined,
    done: task.done === 1,
    due_date: normaliseDateForServer(task.due_date),
    start_date: normaliseDateForServer(task.start_date),
    end_date: normaliseDateForServer(task.end_date),
    priority: task.priority,
    percent_done: Math.round(task.percent_done * 100),
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

/* ───────────────────── pre-push divergence check ─────────────────── */

/**
 * Compare the server's current state against our `last_synced` snapshot.
 * If they differ on any conflict-relevant field, record a conflict row
 * and return true — the caller should abort the push so the user can
 * resolve before we overwrite the server's version.
 *
 * Only meaningful for UPDATE ops (create has no prior state, delete is
 * destructive by nature).
 */
async function checkDivergence(
  lastSynced: string | null,
  currentServerPayload: Record<string, unknown>,
  conflictFields: readonly string[],
  entityType: string,
  localId: string,
): Promise<boolean> {
  if (!lastSynced) return false;

  let before: Record<string, unknown>;
  try {
    before = JSON.parse(lastSynced) as Record<string, unknown>;
  } catch {
    return false; // garbled snapshot; can't compare
  }

  const diverged = conflictFields.filter((f) => before[f] !== currentServerPayload[f]);
  if (diverged.length === 0) return false;

  const now = new Date().toISOString();
  await exec(
    `INSERT INTO conflicts
       (entity_type, entity_local_id, fields, local_snapshot, remote_snapshot, detected_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entityType,
      localId,
      JSON.stringify(diverged),
      lastSynced,
      JSON.stringify(currentServerPayload),
      now,
    ],
  );
  notify('conflicts');
  return true;
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
  position: number | null;
  updated_at: string;
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
            hex_color, is_archived, position, updated_at, deleted
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
         WHERE local_id = ? AND updated_at = ?`,
        [
          newServerId ?? null,
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
          row.updated_at,
        ],
      );
    });
    notify('projects');
    return;
  }

  if (op.op === 'update') {
    if (row.deleted === 1) return;
    if (row.server_id === null) {
      throw new ApiError(408, null, 'Cannot update a project without server id', true, true);
    }

    // Pre-push divergence check
    const [projLastSynced] = await db.select<{ last_synced: string | null }[]>(
      `SELECT last_synced FROM projects WHERE local_id = ? LIMIT 1`,
      [localId],
    );
    if (projLastSynced?.last_synced) {
      try {
        const serverPayload = await callApi(
          client.GET('/projects/{id}', { params: { path: { id: row.server_id } } }),
        ) as Record<string, unknown> | undefined;
        if (serverPayload) {
          const conflicted = await checkDivergence(
            projLastSynced.last_synced,
            serverPayload,
            ['title', 'description'],
            'project',
            localId,
          );
          if (conflicted) return;
        }
      } catch {
        // skip divergence check on fetch failure
      }
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
         WHERE local_id = ? AND updated_at = ?`,
        [
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
          row.updated_at,
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
      // Prune relations for the project's tasks BEFORE deleting them —
      // the subquery needs those task rows to still exist.
      await tx.execute(
        `DELETE FROM task_relations
          WHERE task_local_id IN (SELECT local_id FROM tasks WHERE project_local_id = ?)
             OR other_task_local_id IN (SELECT local_id FROM tasks WHERE project_local_id = ?)`,
        [localId, localId],
      );
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
    position: row.position ?? undefined,
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
  updated_at: string;
  deleted: number;
}

async function executeLabelOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  const localId = op.entity_local_id;
  const [row] = await db.select<LabelRow[]>(
    `SELECT local_id, server_id, title, description, hex_color, updated_at, deleted
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
         WHERE local_id = ? AND updated_at = ?`,
        [
          newServerId ?? null,
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
          row.updated_at,
        ],
      );
    });
    notify('labels');
    return;
  }

  if (op.op === 'update') {
    if (row.deleted === 1) return;
    if (row.server_id === null) {
      throw new ApiError(408, null, 'Cannot update a label without server id', true, true);
    }

    // Pre-push divergence check
    const [labelLastSynced] = await db.select<{ last_synced: string | null }[]>(
      `SELECT last_synced FROM labels WHERE local_id = ? LIMIT 1`,
      [localId],
    );
    if (labelLastSynced?.last_synced) {
      try {
        const serverPayload = await callApi(
          client.GET('/labels/{id}', { params: { path: { id: row.server_id } } }),
        ) as Record<string, unknown> | undefined;
        if (serverPayload) {
          const conflicted = await checkDivergence(
            labelLastSynced.last_synced,
            serverPayload,
            ['title', 'description'],
            'label',
            localId,
          );
          if (conflicted) return;
        }
      } catch {
        // skip divergence check on fetch failure
      }
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
         WHERE local_id = ? AND updated_at = ?`,
        [
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
          row.updated_at,
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

/* ───────────────────────── view ops ──────────────────────── */

interface ViewRow {
  local_id: string;
  server_id: number | null;
  project_local_id: string;
  title: string;
  view_kind: string;
  position: number | null;
  bucket_configuration_mode: string;
  done_bucket_server_id: number | null;
  default_bucket_server_id: number | null;
  deleted: number;
}

type ViewKindLiteral = 'list' | 'gantt' | 'table' | 'kanban';
type BucketModeLiteral = 'none' | 'manual' | 'filter';

function viewBody(row: ViewRow): Record<string, unknown> {
  return {
    title: row.title,
    view_kind: row.view_kind as ViewKindLiteral,
    ...(row.position != null ? { position: row.position } : {}),
    bucket_configuration_mode: row.bucket_configuration_mode as BucketModeLiteral,
    // Vikunja uses 0 for "no done/default bucket".
    done_bucket_id: row.done_bucket_server_id ?? 0,
    default_bucket_id: row.default_bucket_server_id ?? 0,
  };
}

async function executeViewOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  const localId = op.entity_local_id;
  const [row] = await db.select<ViewRow[]>(
    `SELECT local_id, server_id, project_local_id, title, view_kind,
            position, bucket_configuration_mode,
            done_bucket_server_id, default_bucket_server_id, deleted
       FROM project_views WHERE local_id = ? LIMIT 1`,
    [localId],
  );
  if (!row) return;

  const [proj] = await db.select<ProjectLookup[]>(
    `SELECT server_id FROM projects WHERE local_id = ? LIMIT 1`,
    [row.project_local_id],
  );
  const projectServerId = proj?.server_id ?? null;

  if (op.op === 'create') {
    if (row.deleted === 1) {
      await exec('DELETE FROM project_views WHERE local_id = ?', [localId]);
      notify('views');
      return;
    }
    if (row.server_id !== null) return;
    if (!projectServerId) {
      throw new ApiError(408, null, 'view: parent project not synced yet', true, true);
    }
    const res = await callApi(
      client.PUT('/projects/{project}/views', {
        params: { path: { project: projectServerId } },
        body: viewBody(row),
      }),
    );
    const newServerId = (res as { id?: number }).id;
    await exec(
      `UPDATE views SET server_id = ?, synced_at = ?, dirty = 0 WHERE local_id = ?`,
      [newServerId ?? null, new Date().toISOString(), localId],
    );
    notify('views');
    return;
  }

  if (op.op === 'update') {
    if (row.deleted === 1) return;
    if (row.server_id === null || !projectServerId) {
      throw new ApiError(408, null, 'view: not synced yet', true, true);
    }
    await callApi(
      client.POST('/projects/{project}/views/{id}', {
        params: { path: { project: projectServerId, id: row.server_id } },
        body: viewBody(row),
      }),
    );
    await exec(
      `UPDATE project_views SET synced_at = ?, dirty = 0 WHERE local_id = ?`,
      [new Date().toISOString(), localId],
    );
    notify('views');
    return;
  }

  if (op.op === 'delete') {
    if (row.server_id !== null && projectServerId) {
      await callApi(
        client.DELETE('/projects/{project}/views/{id}', {
          params: { path: { project: projectServerId, id: row.server_id } },
        }),
      );
    }
    await exec('DELETE FROM project_views WHERE local_id = ?', [localId]);
    notify('views');
  }
}

/* ───────────────────────── bucket ops ─────────────────────── */

interface BucketRow {
  local_id: string;
  server_id: number | null;
  view_local_id: string;
  title: string;
  position: number | null;
  task_limit: number;
  deleted: number;
}

interface ViewContext {
  view_server_id: number | null;
  project_server_id: number | null;
}

/** Resolve the server ids of a view and its parent project from a view
 * local id. Either may be null if not yet synced. */
async function resolveViewContext(
  db: Database,
  viewLocalId: string,
): Promise<ViewContext> {
  const [row] = await db.select<ViewContext[]>(
    `SELECT pv.server_id AS view_server_id, p.server_id AS project_server_id
       FROM project_views pv
       JOIN projects p ON p.local_id = pv.project_local_id
      WHERE pv.local_id = ? LIMIT 1`,
    [viewLocalId],
  );
  return {
    view_server_id: row?.view_server_id ?? null,
    project_server_id: row?.project_server_id ?? null,
  };
}

function bucketBody(row: BucketRow): Record<string, unknown> {
  return {
    title: row.title,
    limit: row.task_limit ?? 0,
    ...(row.position != null ? { position: row.position } : {}),
  };
}

async function executeBucketOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  const localId = op.entity_local_id;
  const [row] = await db.select<BucketRow[]>(
    `SELECT local_id, server_id, view_local_id, title, position, task_limit, deleted
       FROM buckets WHERE local_id = ? LIMIT 1`,
    [localId],
  );
  if (!row) return;

  const { view_server_id: viewServerId, project_server_id: projectServerId } =
    await resolveViewContext(db, row.view_local_id);

  if (op.op === 'create') {
    if (row.deleted === 1) {
      await dropBucketLocally(localId);
      return;
    }
    if (row.server_id !== null) return;
    if (!projectServerId || !viewServerId) {
      throw new ApiError(408, null, 'bucket: parent view not synced yet', true, true);
    }
    const res = await callApi(
      client.PUT('/projects/{id}/views/{view}/buckets', {
        params: { path: { id: projectServerId, view: viewServerId } },
        body: bucketBody(row),
      }),
    );
    const newServerId = (res as { id?: number }).id;
    await exec(
      `UPDATE buckets SET server_id = ?, synced_at = ?, dirty = 0 WHERE local_id = ?`,
      [newServerId ?? null, new Date().toISOString(), localId],
    );
    notify('views');
    return;
  }

  if (op.op === 'update') {
    if (row.deleted === 1) return;
    if (row.server_id === null || !projectServerId || !viewServerId) {
      throw new ApiError(408, null, 'bucket: not synced yet', true, true);
    }
    await callApi(
      client.POST('/projects/{projectID}/views/{view}/buckets/{bucketID}', {
        params: {
          path: {
            projectID: projectServerId,
            view: viewServerId,
            bucketID: row.server_id,
          },
        },
        body: bucketBody(row),
      }),
    );
    await exec(
      `UPDATE buckets SET synced_at = ?, dirty = 0 WHERE local_id = ?`,
      [new Date().toISOString(), localId],
    );
    notify('views');
    return;
  }

  if (op.op === 'delete') {
    if (row.server_id === null) {
      await dropBucketLocally(localId);
      return;
    }
    if (!projectServerId || !viewServerId) {
      throw new ApiError(408, null, 'bucket: parent view not synced yet', true, true);
    }
    await callApi(
      client.DELETE('/projects/{projectID}/views/{view}/buckets/{bucketID}', {
        params: {
          path: {
            projectID: projectServerId,
            view: viewServerId,
            bucketID: row.server_id,
          },
        },
      }),
    );
    await dropBucketLocally(localId);
  }
}

async function dropBucketLocally(localId: string): Promise<void> {
  await withTx(async (tx) => {
    await tx.execute('DELETE FROM task_buckets WHERE bucket_local_id = ?', [localId]);
    await tx.execute('DELETE FROM buckets WHERE local_id = ?', [localId]);
  });
  notify('views');
}

/* ──────────────────────── task-bucket ops ─────────────────── */

async function executeTaskBucketOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  // Payload: { view_local_id, bucket_local_id }; entity is the task.
  const payload = JSON.parse(op.payload) as {
    view_local_id: string;
    bucket_local_id: string;
  };
  const taskLocalId = op.entity_local_id;

  const [taskRow] = await db.select<{ server_id: number | null }[]>(
    `SELECT server_id FROM tasks WHERE local_id = ? LIMIT 1`,
    [taskLocalId],
  );
  const [bucketRow] = await db.select<{ server_id: number | null }[]>(
    `SELECT server_id FROM buckets WHERE local_id = ? LIMIT 1`,
    [payload.bucket_local_id],
  );
  const { view_server_id: viewServerId, project_server_id: projectServerId } =
    await resolveViewContext(db, payload.view_local_id);

  const taskServerId = taskRow?.server_id ?? null;
  const bucketServerId = bucketRow?.server_id ?? null;

  if (!taskServerId || !bucketServerId || !viewServerId || !projectServerId) {
    // The task or its target bucket hasn't synced yet — retry after their
    // create ops land (FIFO keeps those ahead of this assignment).
    throw new ApiError(408, null, 'task_bucket: task/bucket not synced yet', true, true);
  }

  await callApi(
    client.POST('/projects/{project}/views/{view}/buckets/{bucket}/tasks', {
      params: {
        path: {
          project: projectServerId,
          view: viewServerId,
          bucket: bucketServerId,
        },
      },
      body: {
        task_id: taskServerId,
        bucket_id: bucketServerId,
        project_view_id: viewServerId,
      },
    }),
  );
  // Nothing to reconcile locally — the assignment row is already written.
}

/* ──────────────────────── task-position ops ─────────────────── */

async function executeTaskPositionOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  const payload = JSON.parse(op.payload) as {
    view_local_id: string;
    position: number;
  };
  const taskLocalId = op.entity_local_id;

  const [taskRow] = await db.select<{ server_id: number | null }[]>(
    `SELECT server_id FROM tasks WHERE local_id = ? LIMIT 1`,
    [taskLocalId],
  );
  const { view_server_id: viewServerId } = await resolveViewContext(
    db,
    payload.view_local_id,
  );

  const taskServerId = taskRow?.server_id ?? null;

  if (!taskServerId || !viewServerId) {
    throw new ApiError(
      408,
      null,
      'task_position: task/view not synced yet',
      true,
    );
  }

  await callApi(
    client.POST('/tasks/{id}/position', {
      params: {
        path: { id: taskServerId },
      },
      body: {
        position: payload.position,
        project_view_id: viewServerId,
        task_id: taskServerId,
      },
    }),
  );
}
