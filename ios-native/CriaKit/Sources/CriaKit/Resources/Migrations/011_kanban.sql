-- Kanban buckets. Each bucket belongs to a project view of kind 'kanban'.
-- A task belongs to exactly one bucket per kanban view (stored in task_buckets).
--
-- Manual-mode only for MVP: bucket_configuration_mode must be 'manual'.
-- Filter-mode bucket configuration is stored on the view's
-- bucket_configuration JSON and not mirrored here.

CREATE TABLE IF NOT EXISTS buckets (
  local_id          TEXT PRIMARY KEY NOT NULL,
  server_id         INTEGER UNIQUE,
  view_local_id     TEXT NOT NULL REFERENCES project_views(local_id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  position          REAL NOT NULL DEFAULT 0,
  task_limit        INTEGER NOT NULL DEFAULT 0,
  created_by_server_id INTEGER,

  -- Sync metadata
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  synced_at   TEXT,
  last_synced TEXT,
  dirty       INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_buckets_view
  ON buckets(view_local_id, position);

-- Per-view task-bucket assignment.
-- Each task appears at most once per kanban view.
CREATE TABLE IF NOT EXISTS task_buckets (
  task_local_id   TEXT NOT NULL REFERENCES tasks(local_id) ON DELETE CASCADE,
  view_local_id   TEXT NOT NULL REFERENCES project_views(local_id) ON DELETE CASCADE,
  bucket_local_id TEXT NOT NULL REFERENCES buckets(local_id) ON DELETE CASCADE,
  PRIMARY KEY (task_local_id, view_local_id)
);

CREATE INDEX IF NOT EXISTS idx_task_buckets_bucket
  ON task_buckets(bucket_local_id);

-- Track when kanban data was last synced
ALTER TABLE sync_state ADD COLUMN buckets_synced_at TEXT;
