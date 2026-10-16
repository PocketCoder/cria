-- 020_fts_title_description_only.sql
--
-- The search index holds only a task's title and description, but its update
-- trigger (003) fired on every change to a task row: ticking done, a new due
-- date or a reorder rewrote the index entry, description and all. Fire it only
-- when one of the two indexed columns is in the UPDATE. Search reads nothing
-- else from the index (every other filter joins `tasks`), so results are
-- unchanged. Drop and re-create, so running this twice is safe.

DROP TRIGGER IF EXISTS tasks_fts_au;

CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE OF title, description ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
  INSERT INTO tasks_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;
