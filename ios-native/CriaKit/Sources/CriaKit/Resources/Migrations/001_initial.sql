-- Cria initial schema.
-- Mirrors Vikunja entities with sync-related metadata columns
-- (updated_at, synced_at, dirty, deleted) on every syncable table.

-- ---------------------------------------------------------------------------
-- Current logged-in user. Single row enforced by CHECK on id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    server_id       INTEGER NOT NULL,
    username        TEXT NOT NULL,
    email           TEXT,
    name            TEXT,
    raw             TEXT NOT NULL,         -- full server payload as JSON
    fetched_at      TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Projects (formerly "lists"). Tree via parent_local_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    local_id        TEXT PRIMARY KEY,
    server_id       INTEGER UNIQUE,
    title           TEXT NOT NULL,
    description     TEXT,
    parent_local_id TEXT REFERENCES projects(local_id) ON DELETE SET NULL,
    hex_color       TEXT,
    is_archived     INTEGER NOT NULL DEFAULT 0,
    position        REAL,
    updated_at      TEXT NOT NULL,
    synced_at       TEXT,
    last_synced     TEXT,                  -- JSON snapshot for conflict detection
    dirty           INTEGER NOT NULL DEFAULT 0,
    deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_local_id);
CREATE INDEX IF NOT EXISTS idx_projects_dirty  ON projects(dirty) WHERE dirty = 1;
CREATE INDEX IF NOT EXISTS idx_projects_server ON projects(server_id);

-- ---------------------------------------------------------------------------
-- Tasks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
    local_id            TEXT PRIMARY KEY,
    server_id           INTEGER UNIQUE,
    project_local_id    TEXT NOT NULL REFERENCES projects(local_id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    description         TEXT,
    done                INTEGER NOT NULL DEFAULT 0,
    done_at             TEXT,
    due_date            TEXT,
    start_date          TEXT,
    end_date            TEXT,
    priority            INTEGER NOT NULL DEFAULT 0,
    percent_done        REAL NOT NULL DEFAULT 0,
    repeat_after        INTEGER NOT NULL DEFAULT 0,
    repeat_mode         INTEGER NOT NULL DEFAULT 0,
    hex_color           TEXT,
    position            REAL,
    bucket_id           INTEGER,
    cover_image_id      INTEGER,
    created_by_id       INTEGER,
    created_at          TEXT,
    updated_at          TEXT NOT NULL,
    synced_at           TEXT,
    last_synced         TEXT,
    dirty               INTEGER NOT NULL DEFAULT 0,
    deleted             INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tasks_project  ON tasks(project_local_id);
CREATE INDEX IF NOT EXISTS idx_tasks_dirty    ON tasks(dirty) WHERE dirty = 1;
CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_server   ON tasks(server_id);
CREATE INDEX IF NOT EXISTS idx_tasks_not_done ON tasks(project_local_id, done);

-- ---------------------------------------------------------------------------
-- Labels.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labels (
    local_id        TEXT PRIMARY KEY,
    server_id       INTEGER UNIQUE,
    title           TEXT NOT NULL,
    description     TEXT,
    hex_color       TEXT,
    created_by_id   INTEGER,
    updated_at      TEXT NOT NULL,
    synced_at       TEXT,
    last_synced     TEXT,
    dirty           INTEGER NOT NULL DEFAULT 0,
    deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_labels_dirty  ON labels(dirty) WHERE dirty = 1;
CREATE INDEX IF NOT EXISTS idx_labels_server ON labels(server_id);

-- ---------------------------------------------------------------------------
-- Many-to-many: task <-> label.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_labels (
    task_local_id   TEXT NOT NULL REFERENCES tasks(local_id)  ON DELETE CASCADE,
    label_local_id  TEXT NOT NULL REFERENCES labels(local_id) ON DELETE CASCADE,
    updated_at      TEXT NOT NULL,
    synced_at       TEXT,
    dirty           INTEGER NOT NULL DEFAULT 0,
    deleted         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (task_local_id, label_local_id)
);

CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_local_id);
CREATE INDEX IF NOT EXISTS idx_task_labels_dirty ON task_labels(dirty) WHERE dirty = 1;

-- ---------------------------------------------------------------------------
-- Many-to-many: task <-> assignee (server user id; we don't model users locally
-- beyond the logged-in user).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_assignees (
    task_local_id   TEXT    NOT NULL REFERENCES tasks(local_id) ON DELETE CASCADE,
    user_server_id  INTEGER NOT NULL,
    username        TEXT,
    updated_at      TEXT NOT NULL,
    synced_at       TEXT,
    dirty           INTEGER NOT NULL DEFAULT 0,
    deleted         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (task_local_id, user_server_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_dirty ON task_assignees(dirty) WHERE dirty = 1;

-- ---------------------------------------------------------------------------
-- Outbox of pending operations to push to the server. FIFO drain.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type         TEXT NOT NULL,             -- 'task' | 'project' | 'label' | 'task_label' | 'task_assignee'
    entity_local_id     TEXT NOT NULL,
    op                  TEXT NOT NULL,             -- 'create' | 'update' | 'delete'
    payload             TEXT NOT NULL,             -- JSON
    attempts            INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT,
    next_attempt_at     TEXT,
    created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_next   ON outbox(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_entity ON outbox(entity_type, entity_local_id);

-- ---------------------------------------------------------------------------
-- Outbox dead-letter — entries that exceeded the retry budget.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox_dead_letter (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type         TEXT NOT NULL,
    entity_local_id     TEXT NOT NULL,
    op                  TEXT NOT NULL,
    payload             TEXT NOT NULL,
    attempts            INTEGER NOT NULL,
    last_error          TEXT,
    failed_at           TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Sync state: high-watermark timestamps per entity type.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_state (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    projects_synced_at  TEXT,
    tasks_synced_at     TEXT,
    labels_synced_at    TEXT,
    last_full_sync_at   TEXT,
    last_reconcile_at   TEXT
);

INSERT OR IGNORE INTO sync_state (id) VALUES (1);

-- ---------------------------------------------------------------------------
-- Conflicts surfaced to the user. UI clears these after resolution.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conflicts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type         TEXT NOT NULL,
    entity_local_id     TEXT NOT NULL,
    fields              TEXT NOT NULL,             -- JSON array of field names
    local_snapshot      TEXT NOT NULL,             -- JSON
    remote_snapshot     TEXT NOT NULL,             -- JSON
    detected_at         TEXT NOT NULL,
    resolved_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_conflicts_unresolved
    ON conflicts(entity_type, entity_local_id)
    WHERE resolved_at IS NULL;
