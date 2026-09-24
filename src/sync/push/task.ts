import { callApi, type ApiClient } from '@/api/client';
import { withTx, type Database } from '@/db';
import { notify } from '@/db/bus';
import { ApiError } from '@/api/errors';
import { type OutboxRow, type ProjectLookup, type TaskRow, callApiIgnore404, type LabelLookup, cachedCreateResponse, cacheCreateResponse, checkDivergence } from './shared';

export const TASK_CONFLICT_FIELDS = [
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

/**
 * Vikunja requires full ISO 8601 datetime with timezone offset for all
 * date fields (due_date, start_date, end_date). The local DB may store
 * date-only strings (e.g. "2026-06-09") when set from a date picker;
 * normalise to midnight local time so the server accepts the value.
 */
export function normaliseDateForServer(date: string | null | undefined): string | undefined {
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

/** task_label / task_assignee / task_relation link ops. */
export async function executeTaskLinkOp(
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
      await callApiIgnore404(
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
      await callApiIgnore404(
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
      await callApiIgnore404(
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
}

/** Task create / update / delete. */
export async function executeTaskOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {

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
    if (task.server_id !== null) return;

    // Crash-idempotent: use cached server_id if available
    const cachedId = cachedCreateResponse(op.payload);
    if (typeof cachedId === 'number') {
      await withTx(async (tx) => {
        await tx.execute(
          `UPDATE tasks SET server_id = ?, synced_at = ?, dirty = 0 WHERE local_id = ?`,
          [cachedId, new Date().toISOString(), localId],
        );
        await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
      });
      notify('tasks');
      return;
    }

    const projectRows = await db.select<ProjectLookup[]>(
      `SELECT server_id FROM projects WHERE local_id = ? LIMIT 1`,
      [task.project_local_id],
    );
    const projectServerId = projectRows[0]?.server_id;
    // A negative server_id is a pseudo-project (Favorites, a saved filter)
    // — not a real server destination, so it must never reach the API any
    // more than a missing/zero one would.
    if (!projectServerId || projectServerId < 0) {
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

    await cacheCreateResponse(op.id, op.payload, newServerId);

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
      await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
    });
    notify('tasks');
    return;
  }

    if (op.op === 'update') {
      if (task.deleted === 1) return; // delete op will handle it
      if (task.server_id === null) {
        // Create was lost (race in create handler) — re-enqueue so the
        // full current state (including pending user changes) gets sent.
        const [pendingCreate] = await db.select<{ id: number }[]>(
          `SELECT id FROM outbox WHERE entity_type = 'task' AND entity_local_id = ? AND op = 'create' LIMIT 1`,
          [localId],
        );
        if (!pendingCreate) {
          await db.execute(
            `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
             VALUES ('task', ?, 'create', ?, ?)`,
            [localId, JSON.stringify(task), new Date().toISOString()],
          );
          notify('outbox');
        }
        return;
      }

      // Don't push updates while a conflict is unresolved — the user is
      // deciding how to resolve, and pushing now would race their choice.
      const [pendingConflict] = await db.select<{ id: number }[]>(
        `SELECT id FROM conflicts WHERE entity_type = 'task' AND entity_local_id = ? AND resolved_at IS NULL LIMIT 1`,
        [localId],
      );
      if (pendingConflict) {
        throw new ApiError(408, null, 'task has unresolved conflict', true, true);
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
        await tx.execute(
          'DELETE FROM task_relations WHERE task_local_id = ? OR other_task_local_id = ?',
          [localId, localId],
        );
        await tx.execute('DELETE FROM tasks WHERE local_id = ?', [localId]);
      });
      notify('tasks');
      return;
    }
    await callApiIgnore404(
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
