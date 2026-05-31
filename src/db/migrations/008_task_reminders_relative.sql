-- 008_task_reminders_relative.sql
--
-- Allow `reminder_at` to be NULL for relative reminders whose related
-- task date isn't set yet. Vikunja's server stores them anyway
-- (`{relative_period, relative_to, reminder: null}`) and resolves the
-- absolute trigger time once the matching date appears — we need to
-- mirror that locally so the UI shows what the user added even before
-- a due date exists.
--
-- SQLite supports neither DROP CONSTRAINT nor MODIFY COLUMN, so we
-- rebuild the table. The PK on `(task_local_id, reminder_at)` is
-- replaced by a unique index over the full reminder spec — so duplicates
-- ("1h before due" added twice) are still rejected, but multiple
-- no-date relatives on the same task can coexist (e.g. "1h before due"
-- AND "1d before start" with neither date set).

CREATE TABLE task_reminders_new (
  task_local_id   TEXT NOT NULL,
  reminder_at     TEXT,            -- now nullable; absolute when known
  relative_period INTEGER,
  relative_to     TEXT,
  notified        INTEGER NOT NULL DEFAULT 0
);

INSERT INTO task_reminders_new (task_local_id, reminder_at, relative_period, relative_to, notified)
  SELECT task_local_id, reminder_at, relative_period, relative_to, notified
    FROM task_reminders;

DROP TABLE task_reminders;
ALTER TABLE task_reminders_new RENAME TO task_reminders;

-- Dedupe key: each (task, resolved-time, relative-spec) tuple appears
-- at most once. COALESCE makes NULLs hash to a stable sentinel so the
-- index actually rejects duplicates that NULLs would otherwise hide.
CREATE UNIQUE INDEX idx_task_reminders_uniq
  ON task_reminders(
    task_local_id,
    COALESCE(reminder_at, ''),
    COALESCE(relative_period, -2147483648),
    COALESCE(relative_to, '')
  );

CREATE INDEX idx_task_reminders_task
  ON task_reminders(task_local_id);
