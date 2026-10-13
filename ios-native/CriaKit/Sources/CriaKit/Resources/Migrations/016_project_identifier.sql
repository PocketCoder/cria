-- Add the project identifier column. The server generates a unique short
-- identifier per project (e.g. "PROJ") that is used to build human-readable
-- task identifiers like "PROJ-42". Stored locally so the UI can show and
-- edit it without waiting for a pull.

ALTER TABLE projects ADD COLUMN identifier TEXT;
