-- 007_task_relations.sql
--
-- Local mirror of Vikunja's task_relations (models.TaskRelation), so the
-- detail card can render sub-tasks / parent / related / blocked / etc.
-- One row per (owning task, other task, kind). Vikunja's server auto-
-- creates the inverse on the other task; we mirror both directions
-- as they come back from the pull rather than synthesising them.
--
-- `other_task_local_id` is the resolved local row when we have it; for
-- relations to tasks not yet synced into our DB we carry the
-- `other_task_server_id` instead and re-resolve on later pulls. A row
-- with both NULL is invalid and should be rejected at the call site.
--
-- Uniqueness is enforced by a UNIQUE INDEX with a COALESCE expression
-- because SQLite forbids expressions in PRIMARY KEY / UNIQUE table
-- constraints (only indexes accept them). The application uses
-- INSERT OR REPLACE which honours the index just like a PK would.
--
-- Vikunja's RelationKind enum (pkg/models/task_relation.go):
--   subtask, parenttask, related, duplicates, duplicateof,
--   blocking, blocked, precedes, follows, copiedfrom, copiedto
-- We store the string verbatim; the UI groups by kind for display.

CREATE TABLE IF NOT EXISTS task_relations (
  task_local_id        TEXT NOT NULL,
  other_task_local_id  TEXT,
  other_task_server_id INTEGER,
  relation_kind        TEXT NOT NULL,
  created_at           TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_relations_uniq
  ON task_relations(
    task_local_id,
    relation_kind,
    COALESCE(other_task_local_id, CAST(other_task_server_id AS TEXT))
  );

CREATE INDEX IF NOT EXISTS idx_task_relations_task
  ON task_relations(task_local_id);
CREATE INDEX IF NOT EXISTS idx_task_relations_other_local
  ON task_relations(other_task_local_id);
CREATE INDEX IF NOT EXISTS idx_task_relations_other_server
  ON task_relations(other_task_server_id);
