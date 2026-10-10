-- 006_task_reminders.sql
--
-- Local mirror of each task's reminders (models.TaskReminder), so the
-- detail card can show them and a local scheduler can fire desktop
-- notifications when they come due. `reminder_at` is the absolute time
-- Vikunja resolves even for relative reminders; relative_period /
-- relative_to are kept for display/editing.
--
-- `notified` is LOCAL-ONLY (per device, never synced) — set to 1 once
-- this device has fired its desktop notification, so we don't re-notify
-- on every pull. replaceTaskRemindersFromServer preserves it for
-- reminders that still exist.

CREATE TABLE IF NOT EXISTS task_reminders (
  task_local_id   TEXT NOT NULL,
  reminder_at     TEXT NOT NULL,   -- absolute ISO datetime
  relative_period INTEGER,         -- seconds offset (NULL = absolute)
  relative_to     TEXT,            -- date field the offset is relative to
  notified        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_local_id, reminder_at)
);

CREATE INDEX IF NOT EXISTS idx_task_reminders_task
  ON task_reminders(task_local_id);
