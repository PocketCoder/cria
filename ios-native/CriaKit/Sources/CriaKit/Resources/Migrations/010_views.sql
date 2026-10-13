-- Project views (list / gantt / table / kanban). Each project has one or
-- more views; Vikunja creates four defaults per project. Locally we
-- mirror the server's ProjectView model so we can select which view to
-- present without fetching it each time.
--
-- See src/domain/view.ts for the domain type and src/db/views.ts for the
-- repository layer.

CREATE TABLE IF NOT EXISTS project_views (
  local_id                    TEXT PRIMARY KEY NOT NULL,
  server_id                   INTEGER UNIQUE,
  project_local_id            TEXT NOT NULL REFERENCES projects(local_id) ON DELETE CASCADE,
  title                       TEXT NOT NULL,
  view_kind                   TEXT NOT NULL CHECK (view_kind IN ('list', 'gantt', 'table', 'kanban')),
  position                    REAL NOT NULL DEFAULT 0,
  filter                      TEXT,
  bucket_configuration_mode   TEXT NOT NULL DEFAULT 'none' CHECK (bucket_configuration_mode IN ('none', 'manual', 'filter')),
  bucket_configuration        TEXT,
  default_bucket_server_id    INTEGER,
  done_bucket_server_id       INTEGER,

  -- Sync metadata (same pattern as every syncable entity)
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  synced_at   TEXT,
  last_synced TEXT,
  dirty       INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_project_views_project
  ON project_views(project_local_id, position);

-- Track when views were last synced
ALTER TABLE sync_state ADD COLUMN views_synced_at TEXT;
