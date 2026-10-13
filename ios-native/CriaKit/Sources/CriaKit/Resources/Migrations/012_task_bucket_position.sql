-- Add position column to task_buckets for intra-bucket drag-to-reorder.
-- Positions are per-task-per-view: a task has a position within each bucket
-- it belongs to. Default 0 puts new/unsorted tasks at the start.

ALTER TABLE task_buckets ADD COLUMN position REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_task_buckets_position
  ON task_buckets(view_local_id, bucket_local_id, position);
