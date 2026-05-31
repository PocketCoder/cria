import { exec, getDb, withTx } from './index';
import { notify } from './bus';
import type { TaskReminderResponse } from '@/domain/task';

export interface TaskReminder {
  reminderAt: string;
  relativePeriod: number | null;
  relativeTo: string | null;
  notified: boolean;
}

interface ReminderRow {
  reminder_at: string;
  relative_period: number | null;
  relative_to: string | null;
  notified: number;
}

/**
 * Mirror a task's reminders from the server. Read-path / silent.
 *
 * Wipe-and-reinsert is the safe choice here because both absolute and
 * relative reminders can change shape across pulls (the server may
 * resolve `relative_period+relative_to` into an absolute `reminder` as
 * soon as the related date appears). The earlier "preserve notified
 * across pulls" trick we used for absolute-only reminders is paused
 * for now — the cost is one duplicate desktop notification per pull
 * cycle in the unlucky case where a reminder fired between two pulls.
 * If that becomes a real pain we can re-introduce notified preservation
 * keyed on (relative_period, relative_to) for relatives and reminder_at
 * for absolutes; both keys reliably identify the same logical reminder.
 */
export async function replaceTaskRemindersFromServer(
  taskLocalId: string,
  reminders: TaskReminderResponse[],
): Promise<void> {
  await withTx(async (tx) => {
    await tx.execute(
      `DELETE FROM task_reminders WHERE task_local_id = ?`,
      [taskLocalId],
    );
    for (const r of reminders) {
      // Skip the Vikunja zero-date ("0001-01-01T00:00:00Z") that the
      // server emits for relative reminders with no resolved time —
      // treat it as null instead. Same convention normaliseDate() uses
      // for due/start/end dates.
      const at = r.reminder && r.reminder !== '0001-01-01T00:00:00Z'
        ? r.reminder
        : null;
      const period = typeof r.relative_period === 'number' ? r.relative_period : null;
      const relTo = r.relative_to ?? null;
      // A row with no resolved time AND no relative spec is meaningless;
      // skip it (defensive against malformed server data).
      if (at == null && period == null && relTo == null) continue;
      await tx.execute(
        `INSERT OR IGNORE INTO task_reminders
           (task_local_id, reminder_at, relative_period, relative_to, notified)
         VALUES (?, ?, ?, ?, 0)`,
        [taskLocalId, at, period, relTo],
      );
    }
  });
}

export async function listRemindersForTask(
  taskLocalId: string,
): Promise<TaskReminder[]> {
  const db = await getDb();
  const rows = await db.select<ReminderRow[]>(
    `SELECT reminder_at, relative_period, relative_to, notified
       FROM task_reminders
      WHERE task_local_id = ?
      ORDER BY reminder_at ASC`,
    [taskLocalId],
  );
  return rows.map((r) => ({
    reminderAt: r.reminder_at,
    relativePeriod: r.relative_period,
    relativeTo: r.relative_to,
    notified: r.notified === 1,
  }));
}

export interface DueReminder {
  taskLocalId: string;
  taskTitle: string;
  reminderAt: string;
}

/**
 * Unnotified reminders for non-done, non-deleted tasks (with the task
 * title for the notification body). The scheduler decides "due now" in
 * JS via Date comparison rather than SQL string-compare on ISO values.
 */
export async function listUnnotifiedReminders(): Promise<DueReminder[]> {
  const db = await getDb();
  // `reminder_at IS NOT NULL` excludes relative reminders that don't
  // yet have a resolved trigger time (task has no due/start/end date,
  // or hasn't synced yet). They'll appear in this list once the date
  // is set + the next pull mirrors the resolved time.
  const rows = await db.select<
    { task_local_id: string; title: string; reminder_at: string }[]
  >(
    `SELECT r.task_local_id, t.title, r.reminder_at
       FROM task_reminders r
       JOIN tasks t ON t.local_id = r.task_local_id
      WHERE r.notified = 0 AND r.reminder_at IS NOT NULL
        AND t.done = 0 AND t.deleted = 0`,
  );
  return rows.map((r) => ({
    taskLocalId: r.task_local_id,
    taskTitle: r.title,
    reminderAt: r.reminder_at,
  }));
}

export async function markReminderNotified(
  taskLocalId: string,
  reminderAt: string,
): Promise<void> {
  await exec(
    `UPDATE task_reminders SET notified = 1
      WHERE task_local_id = ? AND reminder_at = ?`,
    [taskLocalId, reminderAt],
  );
}

/* ───────────────────────── user mutations ──────────────────────────── */
//
// Reminders are a task FIELD in Vikunja (no dedicated endpoint), so a
// reminder change is pushed as a task update: we edit task_reminders,
// mark the task dirty, and queue a task 'update' outbox op. The drain
// (push.ts) reads the current task_reminders set and sends it in the
// task body. `reminderAt` is an absolute ISO datetime.

export type ReminderRelation = 'due_date' | 'start_date' | 'end_date';

export interface AddReminderInput {
  /** Absolute trigger time (ISO). Set this OR `period`+`relativeTo`. */
  at?: string;
  /** Seconds offset relative to `relativeTo`. Negative = before. */
  period?: number;
  /** Which date field the offset is relative to. */
  relativeTo?: ReminderRelation;
}

/**
 * Add a reminder to a task and queue the sync.
 *
 * Accepts either an absolute trigger time (`at`) or a relative spec
 * (`period` + `relativeTo`). For relative reminders the *server* is
 * authoritative for the resolved absolute time, but we compute a best-
 * effort local `reminder_at` from the task's matching date so the
 * scheduler can fire before the next pull confirms it. If the task
 * doesn't have the matching date yet, `reminder_at` is left null and
 * the reminder won't fire locally until either the date is set OR the
 * server resolves it on next pull — matching Vikunja-web's behaviour.
 */
export async function addReminder(
  taskLocalId: string,
  input: AddReminderInput,
): Promise<void> {
  const now = new Date().toISOString();
  const relative = input.period != null && input.relativeTo != null;

  // Local optimistic resolution of the trigger time. Server still owns
  // the canonical value — we overwrite this on the next pull through
  // `replaceTaskRemindersFromServer` once the round-trip lands.
  let resolvedAt: string | null = input.at ?? null;
  if (relative) {
    const db = await getDb();
    const [row] = await db.select<{ d: string | null }[]>(
      `SELECT
         CASE ?
           WHEN 'due_date'   THEN due_date
           WHEN 'start_date' THEN start_date
           WHEN 'end_date'   THEN end_date
         END AS d
         FROM tasks WHERE local_id = ? LIMIT 1`,
      [input.relativeTo, taskLocalId],
    );
    const baseIso = row?.d ?? null;
    if (baseIso) {
      const base = new Date(baseIso);
      if (!Number.isNaN(base.getTime())) {
        resolvedAt = new Date(base.getTime() + (input.period ?? 0) * 1000)
          .toISOString();
      }
    }
  }

  await withTx(async (tx) => {
    // Insert the row keyed on the resolved-at value (NULL if the task
    // doesn't have the matching date yet — migration 008 widened the
    // column to nullable). The unique index over the (task, at, period,
    // relativeTo) tuple ignores duplicates, so re-adding the same
    // preset is a no-op.
    await tx.execute(
      `INSERT OR IGNORE INTO task_reminders
         (task_local_id, reminder_at, relative_period, relative_to, notified)
       VALUES (?, ?, ?, ?, 0)`,
      [
        taskLocalId,
        resolvedAt,
        relative ? input.period : null,
        relative ? input.relativeTo : null,
      ],
    );
    await tx.execute(
      `UPDATE tasks SET dirty = 1, updated_at = ? WHERE local_id = ?`,
      [now, taskLocalId],
    );
    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task', ?, 'update', ?, ?)`,
      [taskLocalId, JSON.stringify({ reminders: true }), now],
    );
  });
  notify('tasks');
  notify('outbox');
}

/**
 * Identify a reminder for deletion. Absolute reminders use `at`; relative
 * reminders use `period`+`relativeTo`. Pass whichever set the row has —
 * the SQL matches on the non-null fields and treats the rest as
 * wildcards via IS-NULL coalescing.
 */
export interface RemoveReminderKey {
  at?: string | null;
  period?: number | null;
  relativeTo?: ReminderRelation | null;
}

/** Remove a reminder from a task and queue the sync. */
export async function removeReminder(
  taskLocalId: string,
  key: RemoveReminderKey,
): Promise<void> {
  const now = new Date().toISOString();
  await withTx(async (tx) => {
    // Match on the exact tuple, with NULL-safe equality via IS for the
    // optional fields. Same tuple shape the unique index uses.
    await tx.execute(
      `DELETE FROM task_reminders
        WHERE task_local_id = ?
          AND COALESCE(reminder_at, '')     = COALESCE(?, '')
          AND COALESCE(relative_period, -2147483648) = COALESCE(?, -2147483648)
          AND COALESCE(relative_to, '')     = COALESCE(?, '')`,
      [
        taskLocalId,
        key.at ?? null,
        key.period ?? null,
        key.relativeTo ?? null,
      ],
    );
    await tx.execute(
      `UPDATE tasks SET dirty = 1, updated_at = ? WHERE local_id = ?`,
      [now, taskLocalId],
    );
    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task', ?, 'update', ?, ?)`,
      [taskLocalId, JSON.stringify({ reminders: true }), now],
    );
  });
  notify('tasks');
  notify('outbox');
}
