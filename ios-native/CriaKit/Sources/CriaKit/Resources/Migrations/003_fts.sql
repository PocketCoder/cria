-- FTS5 full-text search index over tasks (title + description).
--
-- External content table: the actual text lives in `tasks`; FTS5 reads it
-- via rowid. Triggers keep the index in sync on INSERT / UPDATE / DELETE.
--
-- tokenizer: porter stemmer + unicode61 (handles unicode, splits on word
-- boundaries, strips diacritics).

CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  title, description,
  content='tasks',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Triggers to keep the FTS index in sync

CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
  INSERT INTO tasks_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;

-- Populate the index with existing data
INSERT INTO tasks_fts(rowid, title, description)
SELECT rowid, title, description FROM tasks;
