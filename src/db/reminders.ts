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
 * Uses INSERT OR IGNORE + a targeted DELETE rather than wipe-and-reinsert
 * so the LOCAL-ONLY `notified` flag survives for reminders that still
 * exist — otherwise every pull would reset it and we'd re-fire the
 * desktop notification.
 */
export async function replaceTaskRemindersFromServer(
  taskLocalId: string,
  reminders: TaskReminderResponse[],
): Promise<void> {
  // Only reminders with an absolute time are schedulable.
  const incoming = reminders.filter((r) => r.reminder);

  for (const r of incoming) {
    await exec(
      `INSERT OR IGNORE INTO task_reminders
         (task_local_id, reminder_at, relative_period, relative_to, notified)
       VALUES (?, ?, ?, ?, 0)`,
      [taskLocalId, r.reminder, r.relative_period ?? null, r.relative_to ?? null],
    );
  }

  if (incoming.length > 0) {
    const placeholders = incoming.map(() => '?').join(', ');
    await exec(
      `DELETE FROM task_reminders
        WHERE task_local_id = ? AND reminder_at NOT IN (${placeholders})`,
      [taskLocalId, ...incoming.map((r) => r.reminder as string)],
    );
  } else {
    await exec(`DELETE FROM task_reminders WHERE task_local_id = ?`, [
      taskLocalId,
    ]);
  }
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
  const rows = await db.select<
    { task_local_id: string; title: string; reminder_at: string }[]
  >(
    `SELECT r.task_local_id, t.title, r.reminder_at
       FROM task_reminders r
       JOIN tasks t ON t.local_id = r.task_local_id
      WHERE r.notified = 0 AND t.done = 0 AND t.deleted = 0`,
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

/** Add a reminder to a task and queue the sync. */
export async function addReminder(
  taskLocalId: string,
  reminderAt: string,
): Promise<void> {
  const now = new Date().toISOString();
  await withTx(async (tx) => {
    await tx.execute(
      `INSERT OR IGNORE INTO task_reminders
         (task_local_id, reminder_at, relative_period, relative_to, notified)
       VALUES (?, ?, NULL, NULL, 0)`,
      [taskLocalId, reminderAt],
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

/** Remove a reminder from a task and queue the sync. */
export async function removeReminder(
  taskLocalId: string,
  reminderAt: string,
): Promise<void> {
  const now = new Date().toISOString();
  await withTx(async (tx) => {
    await tx.execute(
      `DELETE FROM task_reminders WHERE task_local_id = ? AND reminder_at = ?`,
      [taskLocalId, reminderAt],
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
