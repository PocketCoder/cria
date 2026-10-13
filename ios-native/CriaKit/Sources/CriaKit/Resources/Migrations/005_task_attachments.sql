-- 005_task_attachments.sql
--
-- Server-authoritative (read-only) mirror of each task's attachments, so
-- the detail card can list them offline and task rows can show a paperclip
-- without a per-row network fetch. No dirty/outbox columns: Vikunja marks
-- task.attachments read-only (uploads go through a separate endpoint), so
-- Cria only ever reads these — they're refreshed wholesale on each task
-- pull (replaceTaskAttachmentsFromServer).

CREATE TABLE IF NOT EXISTS task_attachments (
  task_local_id TEXT NOT NULL,
  server_id     INTEGER NOT NULL,   -- models.TaskAttachment.id (download URL)
  file_id       INTEGER,            -- files.File.id
  file_name     TEXT,
  file_size     INTEGER,
  mime          TEXT,
  created_at    TEXT,
  PRIMARY KEY (task_local_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task
  ON task_attachments(task_local_id);
