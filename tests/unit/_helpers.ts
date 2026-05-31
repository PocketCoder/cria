// Shared test fixtures.
//
// Lives outside the `tests/unit/**/*.test.ts` glob so vitest doesn't try
// to collect it as a test file (see vitest.config.ts `include`).
//
// `process.env.VITEST` triggers the in-memory better-sqlite3 path in
// src/db/index.ts (see the `new BetterSqlite(... ':memory:' ...)` line),
// so every test run gets a fresh DB.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDb } from '@/db';

/** Run all migrations against the in-memory DB.
 *
 * 001 uses `CREATE TABLE IF NOT EXISTS` so it's idempotent. 002+ use
 * bare `ALTER TABLE ADD COLUMN` which will throw "duplicate column" on
 * the second invocation. Vitest can share a worker (and therefore the
 * `getDb()` module singleton) across test files, so we swallow that
 * specific error here. Any other migration failure still bubbles up. */
export async function initSchema(): Promise<void> {
  const db = await getDb();
  for (const file of [
    '001_initial.sql',
    '002_task_fields.sql',
    '003_fts.sql',
    '004_project_favorite.sql',
    '005_task_attachments.sql',
    '006_task_reminders.sql',
    '007_task_relations.sql',
    '008_task_reminders_relative.sql',
    '009_task_identifier.sql',
  ]) {
    const sql = await fs.readFile(
      path.join(__dirname, '../../src/db/migrations', file),
      'utf8',
    );
    try {
      await db.execute(sql);
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e);
      // Idempotent-on-re-run failure modes from the migration set:
      // - 002+ use bare ALTER TABLE ADD COLUMN ("duplicate column")
      // - 008 rebuilds task_reminders, second run trips "table already
      //   exists" on the staging table.
      if (
        !/duplicate column name/i.test(msg) &&
        !/already exists/i.test(msg)
      ) {
        throw e;
      }
    }
  }
}

/** Wipe every data table between tests. Preserves the singleton
 * `sync_state` row so push/pull code that updates it doesn't trip a
 * missing-row guard. */
export async function clearTables(): Promise<void> {
  const db = await getDb();
  const tables = [
    'conflicts',
    'outbox_dead_letter',
    'outbox',
    'task_relations',
    'task_reminders',
    'task_attachments',
    'task_assignees',
    'task_labels',
    'tasks',
    'labels',
    'projects',
    'sync_state',
  ];
  for (const t of tables) {
    await db.execute(`DELETE FROM ${t}`);
  }
  await db.execute('INSERT OR IGNORE INTO sync_state (id) VALUES (1)');
}

/** Insert a clean project row keyed by server_id. Returns local_id. */
export async function seedProject(
  serverId: number,
  title = 'Test project',
): Promise<string> {
  const db = await getDb();
  const localId = 'proj_' + serverId;
  await db.execute(
    `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted)
     VALUES (?, ?, ?, ?, 0, 0)`,
    [localId, serverId, title, new Date().toISOString()],
  );
  return localId;
}
