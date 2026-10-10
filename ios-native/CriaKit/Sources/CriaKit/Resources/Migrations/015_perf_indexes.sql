-- Performance indexes only — no schema/column changes.
--
-- The smart views (Today / Upcoming) and the dock badge call
-- listTasksWithDueDate(), which scans tasks across ALL projects for
-- incomplete, due-dated rows:
--   WHERE deleted = 0 AND done = 0 AND due_date IS NOT NULL
-- The existing idx_tasks_not_done is (project_local_id, done) — keyed on
-- project first, so it can't serve this cross-project filter, leaving a full
-- table scan that runs on every Today/Upcoming refresh. This partial index
-- matches that predicate exactly and keeps it to just the live, due-dated rows.
CREATE INDEX IF NOT EXISTS idx_tasks_active_due
  ON tasks(due_date)
  WHERE deleted = 0 AND done = 0 AND due_date IS NOT NULL;
