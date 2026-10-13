-- 019_attachment_uploads.sql
--
-- Local-first attachment uploads. Picking a file (or pasting an image into a
-- description) inserts a task_attachments row straight away, flagged
-- `pending`, plus a `task_attachment`·`upload` outbox op. The file's bytes
-- wait in the Rust side-store (src-tauri/src/blobs.rs) under `bytes_path`
-- until the outbox drain uploads them; then the row gets its server_id and
-- `pending`/`bytes_path` clear.
--
-- 005 keyed rows on (task_local_id, server_id) with server_id NOT NULL, but a
-- pending row has no server id yet. SQLite can drop neither a primary key nor
-- a NOT NULL, so rebuild the table: a client-side `local_id` becomes the key,
-- and (task_local_id, server_id) stays unique for server-mirrored rows (NULLs
-- are distinct in a SQLite unique index, so pending rows never collide).

CREATE TABLE task_attachments_new (
  local_id      TEXT PRIMARY KEY NOT NULL,  -- client-side id; also the side-store key while pending
  task_local_id TEXT NOT NULL,
  server_id     INTEGER,                    -- models.TaskAttachment.id; NULL until uploaded
  file_id       INTEGER,                    -- files.File.id
  file_name     TEXT,
  file_size     INTEGER,
  mime          TEXT,
  created_at    TEXT,
  pending       INTEGER NOT NULL DEFAULT 0, -- 1 = queued for upload
  bytes_path    TEXT                        -- side-store key of the queued bytes; NULL once uploaded
);

-- Every existing row is a server mirror. New rows get a nanoid from the app;
-- here any unique value will do.
INSERT INTO task_attachments_new
  (local_id, task_local_id, server_id, file_id, file_name, file_size, mime,
   created_at, pending, bytes_path)
SELECT lower(hex(randomblob(16))), task_local_id, server_id, file_id,
       file_name, file_size, mime, created_at, 0, NULL
  FROM task_attachments;

DROP TABLE task_attachments;
ALTER TABLE task_attachments_new RENAME TO task_attachments;

-- Also serves per-task lookups (leading column), so 005's
-- idx_task_attachments_task, dropped with the old table, isn't recreated.
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_attachments_server
  ON task_attachments(task_local_id, server_id);
