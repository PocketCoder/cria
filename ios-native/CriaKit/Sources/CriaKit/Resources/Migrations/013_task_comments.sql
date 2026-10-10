-- ---------------------------------------------------------------------------
-- 013: task comments
-- Mirrors Vikunja's task comments for read-only display in the detail card.
-- read column is client-side only (tracks viewed/unread state).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS task_comments (
    local_id         TEXT PRIMARY KEY,
    server_id        INTEGER NOT NULL,
    task_local_id    TEXT NOT NULL REFERENCES tasks(local_id),
    comment          TEXT NOT NULL,              -- TipTap HTML from server
    author_server_id INTEGER,
    author_name      TEXT,
    created_at       TEXT,
    updated_at       TEXT,
    read             INTEGER NOT NULL DEFAULT 0, -- client-side read tracking
    synced_at        TEXT,
    dirty            INTEGER NOT NULL DEFAULT 0,
    deleted          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_local_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_dirty ON task_comments(dirty) WHERE dirty = 1;
