// Migration 019 rebuilds task_attachments (005 keyed it on a NOT NULL
// server_id; a queued upload has none). Runs the real SQL files against a
// fresh in-memory SQLite, so existing mirrored rows are checked to survive.

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

/** Apply migrations numbered `from`..`to` (inclusive), in order. */
function runMigrations(db: Sqlite, from: number, to: number): void {
  for (const f of files) {
    const n = Number(f.slice(0, 3));
    if (n >= from && n <= to) db.exec(readFileSync(path.join(DIR, f), 'utf8'));
  }
}

describe('migration 019 (attachment uploads)', () => {
  let db: Sqlite;

  beforeEach(() => {
    db = new BetterSqlite(':memory:');
    runMigrations(db, 1, 18);
  });

  it('is the next migration and is registered Rust-side', () => {
    expect(files.at(-1)).toBe('019_attachment_uploads.sql');
    const lib = readFileSync(path.join(__dirname, '../../src-tauri/src/lib.rs'), 'utf8');
    expect(lib).toContain('019_attachment_uploads.sql');
    expect(lib).toMatch(/version: 19,/);
  });

  it('keeps existing mirrored rows, giving each a local id', () => {
    const insert = db.prepare(
      `INSERT INTO task_attachments (task_local_id, server_id, file_id, file_name, file_size, mime, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('t1', 1, 10, 'a.pdf', 100, 'application/pdf', '2026-01-01T00:00:00Z');
    insert.run('t1', 2, 20, 'b.png', 200, 'image/png', '2026-01-02T00:00:00Z');

    runMigrations(db, 19, 19);

    const rows = db
      .prepare(`SELECT * FROM task_attachments ORDER BY server_id`)
      .all() as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      task_local_id: 't1',
      server_id: 1,
      file_id: 10,
      file_name: 'a.pdf',
      file_size: 100,
      mime: 'application/pdf',
      created_at: '2026-01-01T00:00:00Z',
      pending: 0,
      bytes_path: null,
    });
    expect(typeof rows[0]!.local_id).toBe('string');
    expect(rows[0]!.local_id).not.toBe(rows[1]!.local_id);
  });

  it('allows pending rows without a server id but keeps server ids unique per task', () => {
    runMigrations(db, 19, 19);
    const insert = db.prepare(
      `INSERT INTO task_attachments (local_id, task_local_id, server_id, pending, bytes_path)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run('p1', 't1', null, 1, 'p1');
    insert.run('p2', 't1', null, 1, 'p2');
    insert.run('m1', 't1', 5, 0, null);
    expect(() => insert.run('m2', 't1', 5, 0, null)).toThrow(/UNIQUE/);
    expect(() => insert.run(null, 't1', 6, 0, null)).toThrow(/NOT NULL/);
    expect(db.prepare(`SELECT count(*) AS n FROM task_attachments`).all()).toEqual([{ n: 3 }]);
  });
});
