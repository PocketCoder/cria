import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb, serial, exec, withTx } from '@/db';
import { initSchema, clearTables } from './_helpers';

describe('db/index', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  describe('getDb', () => {
    it('returns a Database instance', async () => {
      const db = await getDb();
      expect(db).toBeDefined();
      expect(typeof db.execute).toBe('function');
      expect(typeof db.select).toBe('function');
    });

    it('returns the same instance on repeated calls', async () => {
      const a = await getDb();
      const b = await getDb();
      expect(a).toBe(b);
    });
  });

  describe('exec', () => {
    it('INSERT returns rowsAffected', async () => {
      const r = await exec(
        `INSERT INTO labels (local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`,
        ['l1', 'test', new Date().toISOString()],
      );
      expect(r.rowsAffected).toBe(1);
      expect(typeof r.lastInsertId).toBe('number');
    });

    it('row is readable after INSERT', async () => {
      await exec(
        `INSERT INTO labels (local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`,
        ['l1', 'hello', new Date().toISOString()],
      );
      const db = await getDb();
      const rows = await db.select<{ title: string }[]>(
        `SELECT title FROM labels WHERE local_id = ?`,
        ['l1'],
      );
      expect(rows[0]!.title).toBe('hello');
    });

    it('UPDATE modifies existing row', async () => {
      await exec(
        `INSERT INTO labels (local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`,
        ['l1', 'old', new Date().toISOString()],
      );
      const r = await exec(
        `UPDATE labels SET title = ? WHERE local_id = ?`,
        ['new', 'l1'],
      );
      expect(r.rowsAffected).toBe(1);
      const db = await getDb();
      const rows = await db.select<{ title: string }[]>(
        `SELECT title FROM labels WHERE local_id = ?`,
        ['l1'],
      );
      expect(rows[0]!.title).toBe('new');
    });

    it('DELETE removes row', async () => {
      await exec(
        `INSERT INTO labels (local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`,
        ['l1', 'gone', new Date().toISOString()],
      );
      const r = await exec(`DELETE FROM labels WHERE local_id = ?`, ['l1']);
      expect(r.rowsAffected).toBe(1);
      const db = await getDb();
      const rows = await db.select<unknown[]>(
        `SELECT * FROM labels WHERE local_id = ?`,
        ['l1'],
      );
      expect(rows.length).toBe(0);
    });

    it('writes are serialised (sequential, not interleaved)', async () => {
      const order: number[] = [];
      await Promise.all([
        exec(`INSERT INTO labels (local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`, ['a', 'first', new Date().toISOString()]).then(() => order.push(1)),
        exec(`INSERT INTO labels (local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`, ['b', 'second', new Date().toISOString()]).then(() => order.push(2)),
      ]);
      expect(order).toEqual([1, 2]);
    });
  });

  describe('withTx', () => {
    it('batches INSERTs atomically', async () => {
      await withTx(async (tx) => {
        await tx.execute(
          `INSERT INTO labels (local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`,
          ['tx1', 'hello', new Date().toISOString()],
        );
        await tx.execute(
          `INSERT INTO labels (local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`,
          ['tx2', 'world', new Date().toISOString()],
        );
      });
      const db = await getDb();
      const rows = await db.select<{ local_id: string }[]>(
        `SELECT local_id FROM labels ORDER BY local_id ASC`,
      );
      expect(rows.map((r) => r.local_id)).toEqual(['tx1', 'tx2']);
    });

    it('runs SELECT pass-through inside callback', async () => {
      await exec(
        `INSERT INTO labels (local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`,
        ['existing', 'preseed', new Date().toISOString()],
      );
      const result = await withTx(async (tx) => {
        const rows = await tx.select<{ local_id: string }[]>(
          `SELECT local_id FROM labels ORDER BY local_id ASC`,
        );
        return rows.length;
      });
      expect(result).toBeGreaterThanOrEqual(1);
    });

    it('does not run an empty batch', async () => {
      await expect(withTx(async () => {})).resolves.toBeUndefined();
    });
  });

  describe('serial', () => {
    it('queues functions sequentially', async () => {
      const acc: string[] = [];
      const p1 = serial(async () => {
        await new Promise((r) => setTimeout(r, 5));
        acc.push('first');
      });
      const p2 = serial(async () => {
        acc.push('second');
      });
      await Promise.all([p1, p2]);
      expect(acc).toEqual(['first', 'second']);
    });

    it('survives a rejection in one entry without poisoning the chain', async () => {
      const err = serial(async () => {
        throw new Error('boom');
      });
      await expect(err).rejects.toThrow('boom');
      const ok = serial(async () => 'recovered');
      await expect(ok).resolves.toBe('recovered');
    });
  });
});
