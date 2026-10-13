-- Add the human-readable task identifier (e.g. "PROJ-42") mirrored from
-- the server's API response. This is a read-only computed field, not
-- writable — the server derives it from the project identifier + task
-- index. We store it locally so it's available in the UI without waiting
-- for a pull.

ALTER TABLE tasks ADD COLUMN identifier TEXT;
