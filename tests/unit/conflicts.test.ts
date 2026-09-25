import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { resolveConflictKeepMine, resolveConflictUseTheirs } from '@/db/conflicts';
import { initSchema, clearTables, seedProject } from './_helpers';

async function seedConflict(): Promise<number> {
  const db = await getDb();
  const proj = await seedProject(1);
  await db.execute(
    `INSERT INTO tasks (local_id, server_id, project_local_id, title, priority, updated_at, dirty, deleted)
     VALUES ('t1', 10, ?, 'mine', 1, '2026-01-01T00:00:00Z', 1, 0)`,
    [proj],
  );
  await db.execute(
    `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
     VALUES ('task', 't1', 'update', '{}', '2026-01-01T00:00:00Z')`,
  );
  const remote = {
    id: 10, title: 'theirs', priority: 4, done: true,
    due_date: '0001-01-01T00:00:00Z', updated: '2026-02-01T00:00:00Z',
  };
  const r = await db.execute(
    `INSERT INTO conflicts (entity_type, entity_local_id, fields, local_snapshot, remote_snapshot, detected_at)
     VALUES ('task', 't1', '["title"]', '{}', ?, '2026-02-01T00:00:00Z')`,
    [JSON.stringify(remote)],
  );
  return r.lastInsertId as number;
}

async function state() {
  const db = await getDb();
  const [task] = await db.select<{ title: string; priority: number; done: number; due_date: string | null; dirty: number }[]>(
    `SELECT title, priority, done, due_date, dirty FROM tasks WHERE local_id = 't1'`,
  );
  const [count] = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM outbox`);
  const outbox = count!.n;
  const [conflict] = await db.select<{ resolved_at: string | null }[]>(`SELECT resolved_at FROM conflicts`);
  return { task, outbox, resolved: conflict?.resolved_at != null };
}

describe('conflict resolution', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  it('keep-mine resolves the conflict and leaves the local edit queued', async () => {
    const id = await seedConflict();
    await resolveConflictKeepMine(id);
    const s = await state();
    expect(s.resolved).toBe(true);
    expect(s.task).toMatchObject({ title: 'mine', priority: 1, dirty: 1 });
    expect(s.outbox).toBe(1);
  });

  it('use-theirs overwrites the row, clears dirty and drops the queued push', async () => {
    const id = await seedConflict();
    await resolveConflictUseTheirs(id);
    const s = await state();
    expect(s.resolved).toBe(true);
    expect(s.task).toEqual({ title: 'theirs', priority: 4, done: 1, due_date: null, dirty: 0 });
    expect(s.outbox).toBe(0);
  });

  it('use-theirs on a missing conflict is a no-op', async () => {
    await expect(resolveConflictUseTheirs(999)).resolves.toBeUndefined();
  });
});
