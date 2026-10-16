// Migration 020 narrows the search index's update trigger to title and
// description. Runs the real SQL files against a fresh in-memory SQLite.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

interface Sqlite {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

const require = createRequire(import.meta.url);
const BetterSqlite = require('better-sqlite3') as new (path: string) => Sqlite;
const DIR = path.join(__dirname, '../../src/db/migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

function runAll(db: Sqlite): void {
  for (const f of files) db.exec(readFileSync(path.join(DIR, f), 'utf8'));
}

function matches(db: Sqlite, term: string): number {
  return db.prepare(`SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH ?`).all(term).length;
}

describe('migration 020 (search index trigger)', () => {
  let db: Sqlite;

  beforeEach(() => {
    db = new BetterSqlite(':memory:');
    runAll(db);
    db.exec(`INSERT INTO projects (local_id, title, updated_at) VALUES ('p1', 'Home', '2026-01-01T00:00:00Z')`);
    db.exec(
      `INSERT INTO tasks (local_id, project_local_id, title, description, updated_at) VALUES ('t1', 'p1', 'Buy milk', 'semi skimmed', '2026-01-01T00:00:00Z')`,
    );
  });

  it('is the latest migration and is registered Rust-side', () => {
    expect(files.at(-1)).toBe('020_fts_title_description_only.sql');
    const lib = readFileSync(path.join(__dirname, '../../src-tauri/src/lib.rs'), 'utf8');
    expect(lib).toContain('020_fts_title_description_only.sql');
    expect(lib).toMatch(/version: 20,/);
  });

  it('fires only on title or description', () => {
    const trigger = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'tasks_fts_au'`)
      .all() as { sql: string }[];
    expect(trigger).toHaveLength(1);
    expect(trigger[0]?.sql).toMatch(/AFTER UPDATE OF title, description ON tasks/);
  });

  it('still follows a title or description edit', () => {
    db.exec(`UPDATE tasks SET title = 'Buy bread' WHERE local_id = 't1'`);
    expect(matches(db, 'bread')).toBe(1);
    expect(matches(db, 'milk')).toBe(0);
    db.exec(`UPDATE tasks SET description = 'wholemeal' WHERE local_id = 't1'`);
    expect(matches(db, 'wholemeal')).toBe(1);
    expect(matches(db, 'skimmed')).toBe(0);
  });

  it('keeps the entry when another column changes', () => {
    db.exec(`UPDATE tasks SET done = 1 WHERE local_id = 't1'`);
    expect(matches(db, 'milk')).toBe(1);
  });

  it('can run again', () => {
    expect(() =>
      db.exec(readFileSync(path.join(DIR, '020_fts_title_description_only.sql'), 'utf8')),
    ).not.toThrow();
  });
});
