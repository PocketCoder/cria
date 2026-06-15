import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb, withTx } from '@/db';
import { initSchema, clearTables } from './_helpers';
import { retryDeadLetter } from '@/sync/push';

const now = () => new Date().toISOString();

describe('retryDeadLetter', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  async function seedDeadLetter(): Promise<number> {
    const db = await getDb();
    await db.execute(
      `INSERT INTO outbox_dead_letter
         (entity_type, entity_local_id, op, payload, attempts, last_error, failed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['task', 'task1', 'update', JSON.stringify({ title: 'X' }), 10, 'boom', now()],
    );
    const rows = await db.select<{ id: number }[]>(
      `SELECT id FROM outbox_dead_letter ORDER BY id DESC LIMIT 1`,
    );
    return rows[0]!.id;
  }

  it('moves a dead-letter row back into the outbox with reset attempts/backoff', async () => {
    const id = await seedDeadLetter();
    const ok = await retryDeadLetter(id);
    expect(ok).toBe(true);

    const db = await getDb();
    const dead = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM outbox_dead_letter`,
    );
    expect(dead[0]!.count).toBe(0);

    const out = await db.select<
      Array<{ entity_type: string; op: string; payload: string; attempts: number; next_attempt_at: string | null }>
    >(`SELECT * FROM outbox`);
    expect(out).toHaveLength(1);
    expect(out[0]!.entity_type).toBe('task');
    expect(out[0]!.op).toBe('update');
    expect(JSON.parse(out[0]!.payload)).toEqual({ title: 'X' });
    expect(out[0]!.attempts).toBe(0);
    expect(out[0]!.next_attempt_at).toBeNull();
  });

  it('returns false and changes nothing for an unknown id', async () => {
    const ok = await retryDeadLetter(99999);
    expect(ok).toBe(false);
    const db = await getDb();
    const out = await db.select<{ count: number }[]>(`SELECT COUNT(*) as count FROM outbox`);
    expect(out[0]!.count).toBe(0);
  });
});

describe('withTx atomicity (Node path)', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  it('rolls back the whole batch when a later statement fails', async () => {
    await withTx(async (tx) => {
      await tx.execute(
        `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['pRB', 1, 'P', now()],
      );
    });

    // A batch that inserts a task and then violates the primary-key constraint
    // on the second insert. The first insert must NOT survive the rollback.
    await expect(
      withTx(async (tx) => {
        await tx.execute(
          `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
          ['tA', 'pRB', 'A', now()],
        );
        await tx.execute(
          `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
          ['tA', 'pRB', 'dup', now()],
        );
      }),
    ).rejects.toThrow();

    const db = await getDb();
    const rows = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM tasks WHERE local_id = ?`,
      ['tA'],
    );
    expect(rows[0]!.count).toBe(0);
  });
});
