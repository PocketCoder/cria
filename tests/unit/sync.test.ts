// Sync and outbox integration tests for M2
// Uses the real DB layer with an in‑memory SQLite file via the existing DB_URI.
// The schema is initialised from the migration script before each test.

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { getDb, withTx } from '@/db';
import { createTask, updateTask, deleteTask } from '@/db/tasks';
import { drainOutbox } from '@/sync/push';
import type { ApiClient } from '@/api/client';
// Use the shared, complete migration list (includes 005–008, 012) rather than
// a hand-maintained subset that drifts as migrations are added.
import { initSchema } from './_helpers';
// import { ApiError } from '@/api/errors';

// Helper to clear all data tables between tests
async function clearTables() {
  const db = await getDb();
  await db.execute('DELETE FROM outbox_dead_letter');
  await db.execute('DELETE FROM outbox');
  await db.execute('DELETE FROM tasks');
  await db.execute('DELETE FROM projects');
  await db.execute('DELETE FROM labels');
  await db.execute('DELETE FROM task_labels');
  await db.execute('DELETE FROM task_assignees');
  await db.execute('DELETE FROM sync_state');
  await db.execute('INSERT OR IGNORE INTO sync_state (id) VALUES (1)');
}

// Simple mock API client that satisfies the shape used by `drainOutbox`
function mockApiClient(): ApiClient {
  const now = new Date().toISOString();
  return {
    // The openapi‑fetch client has many methods; we only need the ones used in push.
    PUT: async () => ({
      data: { id: 123, updated: now },
      response: { ok: true, status: 200, text: async () => '' } as any,
    } as any),
    POST: async () => ({
      data: { updated: now },
      response: { ok: true, status: 200, text: async () => '' } as any,
    } as any),
    DELETE: async () => ({
      data: undefined,
      response: { ok: true, status: 204, text: async () => '' } as any,
    } as any),
    // other methods are unused in this test suite
    GET: async () => ({ data: undefined, response: { ok: true, status: 200, text: async () => '' } as any }),
    // Typescript requires many more properties; we cast to any at call sites.
  } as any as ApiClient;
}

describe('M2 task mutations and outbox', () => {
  beforeAll(async () => {
    await initSchema();
  });

  beforeEach(async () => {
    await clearTables();
  });

  it('createTask inserts row, creates outbox entry and marks dirty', async () => {
    // create a dummy project that is already synced (has server_id)
    const projectLocalId = 'proj_' + Math.random().toString(36).slice(2);
    const now = new Date().toISOString();
    await withTx(async (db) => {
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        [projectLocalId, 1, 'Test Project', now],
      );
    });

    const task = await createTask({ title: 'Test task', projectLocalId });
    expect(task.title).toBe('Test task');
    // Verify outbox entry exists
    const db = await getDb();
    const outbox = await db.select<any[]>(
      `SELECT * FROM outbox WHERE entity_type = 'task' AND entity_local_id = ?`,
      [task.localId],
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].op).toBe('create');
    // Task row should be dirty
    const row = await db.select<any[]>(`SELECT dirty FROM tasks WHERE local_id = ?`, [task.localId]);
    expect(row[0].dirty).toBe(1);
  });

  it('updateTask marks dirty and adds outbox entry', async () => {
    const projectLocalId = 'proj_' + Math.random().toString(36).slice(2);
    const now = new Date().toISOString();
    await withTx(async (db) => {
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        [projectLocalId, 2, 'Proj', now],
      );
    });
    const task = await createTask({ title: 'orig', projectLocalId });
    await updateTask(task.localId, { title: 'changed' });
    const db = await getDb();
    const outbox = await db.select<any[]>(
      `SELECT * FROM outbox WHERE entity_local_id = ? ORDER BY id`,
      [task.localId],
    );
    // Two entries: create then update
    expect(outbox).toHaveLength(2);
    expect(outbox[1].op).toBe('update');
    const row = await db.select<any[]>(`SELECT title, dirty FROM tasks WHERE local_id = ?`, [task.localId]);
    expect(row[0].title).toBe('changed');
    expect(row[0].dirty).toBe(1);
  });

  it('deleteTask soft‑deletes, marks dirty, and adds outbox entry', async () => {
    const projectLocalId = 'proj_' + Math.random().toString(36).slice(2);
    const now = new Date().toISOString();
    await withTx(async (db) => {
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        [projectLocalId, 3, 'Proj', now],
      );
    });
    const task = await createTask({ title: 'to delete', projectLocalId });
    await deleteTask(task.localId);
    const db = await getDb();
    const outbox = await db.select<any[]>(
      `SELECT * FROM outbox WHERE entity_local_id = ? ORDER BY id`,
      [task.localId],
    );
    expect(outbox).toHaveLength(2); // create + delete
    expect(outbox[1].op).toBe('delete');
    const row = await db.select<any[]>(`SELECT deleted, dirty FROM tasks WHERE local_id = ?`, [task.localId]);
    expect(row[0].deleted).toBe(1);
    expect(row[0].dirty).toBe(1);
  });

  it('drainOutbox processes a create operation and clears dirty flag', async () => {
    const projectLocalId = 'proj_' + Math.random().toString(36).slice(2);
    const now = new Date().toISOString();
    // Insert a project with a server_id so the push can resolve it
    await withTx(async (db) => {
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        [projectLocalId, 42, 'Proj', now],
      );
    });
    const task = await createTask({ title: 'push me', projectLocalId });
    // Verify outbox has one entry before drain
    const dbBefore = await getDb();
    const outboxRows = await dbBefore.select<any[]>(`SELECT * FROM outbox`);
    expect(outboxRows).toHaveLength(1);
    // Drain using mock client that pretends server creates task with id 999
    const client = mockApiClient();
await drainOutbox(client);
    // Outbox should be empty
    const dbAfter = await getDb();
    const outboxAfter = await dbAfter.select<any[]>(`SELECT * FROM outbox`);
    expect(outboxAfter).toHaveLength(0);
    // Task row should have server_id set (from mock client) and dirty cleared
    const taskRow = await dbAfter.select<any[]>(
      `SELECT server_id, dirty FROM tasks WHERE local_id = ?`,
      [task.localId],
    );
    expect(taskRow[0]?.server_id).toBe(123);
    expect(taskRow[0]?.dirty).toBe(0);
  });
});
