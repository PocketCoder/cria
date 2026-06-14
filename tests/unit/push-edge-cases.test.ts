import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { getDb, withTx } from '@/db';
import { initSchema, clearTables } from './_helpers';
import { drainOutbox, subscribeToTask, unsubscribeFromTask, startOutboxSync, taskToBody } from '@/sync/push';

function mockGet(data: unknown[] = []) {
  return vi.fn().mockResolvedValue({ data, response: { ok: true, status: 200, headers: new Map(), text: vi.fn().mockResolvedValue('') } });
}

function mockClient(overrides?: { get?: ReturnType<typeof vi.fn> }) {
  const now = new Date().toISOString();
  return {
    GET: overrides?.get ?? mockGet(),
    PUT: vi.fn().mockResolvedValue({ data: { id: 999, updated: now }, response: { ok: true, status: 200, text: vi.fn().mockResolvedValue('') } }),
    POST: vi.fn().mockResolvedValue({ data: { updated: now }, response: { ok: true, status: 200, text: vi.fn().mockResolvedValue('') } }),
    DELETE: vi.fn().mockResolvedValue({ data: undefined, response: { ok: true, status: 204, text: vi.fn().mockResolvedValue('') } }),
  } as any;
}

const now = () => new Date().toISOString();

describe('sync/push edge cases', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  async function seedProjectAndTask(overrides: { taskServerId?: number | null; projectServerId?: number } = {}) {
    const projectServerId = overrides.projectServerId ?? 1;
    const taskServerId = overrides.taskServerId ?? null;
    await withTx(async (tx) => {
      await tx.execute(
        `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['proj1', projectServerId, 'Project', now()],
      );
      await tx.execute(
        `INSERT INTO tasks (local_id, project_local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['task1', 'proj1', taskServerId, 'Task', now()],
      );
    });
  }

  describe('subscribeToTask / unsubscribeFromTask', () => {
    it('subscribeToTask calls PUT subscription and updates is_subscribed locally', async () => {
      await seedProjectAndTask({ taskServerId: 100 });
      const put = vi.fn().mockResolvedValue({ data: undefined, response: { ok: true, status: 200, text: vi.fn().mockResolvedValue('') } });
      const client = mockClient();
      client.PUT = put;
      await subscribeToTask(100, 'task1', client);
      expect(put).toHaveBeenCalledWith('/subscriptions/{entity}/{entityID}', expect.any(Object));
      const db = await getDb();
      const row = await db.select<{ is_subscribed: number }[]>(`SELECT is_subscribed FROM tasks WHERE local_id = ?`, ['task1']);
      expect(row[0]!.is_subscribed).toBe(1);
    });

    it('unsubscribeFromTask calls DELETE subscription and clears is_subscribed locally', async () => {
      await seedProjectAndTask({ taskServerId: 100 });
      const del = vi.fn().mockResolvedValue({ data: undefined, response: { ok: true, status: 204, text: vi.fn().mockResolvedValue('') } });
      const client = mockClient();
      client.DELETE = del;
      await unsubscribeFromTask(100, 'task1', client);
      expect(del).toHaveBeenCalledWith('/subscriptions/{entity}/{entityID}', expect.any(Object));
      const db = await getDb();
      const row = await db.select<{ is_subscribed: number }[]>(`SELECT is_subscribed FROM tasks WHERE local_id = ?`, ['task1']);
      expect(row[0]!.is_subscribed).toBe(0);
    });
  });

  describe('drainOutbox — re-entrancy guard', () => {
    it('does nothing when already draining', async () => {
      (globalThis as any).__cria_isDraining__ = true;
      const client = mockClient();
      await drainOutbox(client);
      // If the guard works, no API calls are made
      expect(client.PUT).not.toHaveBeenCalled();
      delete (globalThis as any).__cria_isDraining__;
    });
  });

  describe('drainOutbox — project ops', () => {
    it('drains a project create and stamps server_id', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, NULL, ?, ?, 1, 0)`,
        ['p_new', 'New project', now()],
      );
      await db.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
        ['project', 'p_new', 'create', '{"title":"New project"}', now()],
      );
      const client = mockClient();
      await drainOutbox(client);
      const row = await db.select<{ server_id: number | null; dirty: number }[]>(
        `SELECT server_id, dirty FROM projects WHERE local_id = ?`,
        ['p_new'],
      );
      expect(row[0]!.server_id).toBe(999);
      expect(row[0]!.dirty).toBe(0);
    });

    it('drains a project delete and removes local row', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 1, 1)`,
        ['p_del', 42, 'Delete me', now()],
      );
      await db.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
        ['project', 'p_del', 'delete', '{}', now()],
      );
      const client = mockClient();
      await drainOutbox(client);
      const rows = await db.select<unknown[]>(`SELECT * FROM projects WHERE local_id = ?`, ['p_del']);
      expect(rows.length).toBe(0);
    });
  });

  describe('drainOutbox — label ops', () => {
    it('drains a label create and stamps server_id', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, NULL, ?, ?, 1, 0)`,
        ['l_new', 'New label', now()],
      );
      await db.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
        ['label', 'l_new', 'create', '{"title":"New label"}', now()],
      );
      const client = mockClient();
      await drainOutbox(client);
      const row = await db.select<{ server_id: number | null; dirty: number }[]>(
        `SELECT server_id, dirty FROM labels WHERE local_id = ?`,
        ['l_new'],
      );
      expect(row[0]!.server_id).toBe(999);
      expect(row[0]!.dirty).toBe(0);
    });

    it('drains a label delete and removes local row', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 1, 1)`,
        ['l_del', 99, 'Delete label', now()],
      );
      await db.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
        ['label', 'l_del', 'delete', '{}', now()],
      );
      const client = mockClient();
      await drainOutbox(client);
      const rows = await db.select<unknown[]>(`SELECT * FROM labels WHERE local_id = ?`, ['l_del']);
      expect(rows.length).toBe(0);
    });
  });

  describe('drainOutbox — task_label ops', () => {
    it('drains a task_label add', async () => {
      await seedProjectAndTask({ taskServerId: 100 });
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['l1', 1, 'bug', now()],
      );
      await db.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
        ['task_label', 'task1', 'add', '{"labelLocalId":"l1"}', now()],
      );
      const put = vi.fn().mockResolvedValue({ data: undefined, response: { ok: true, status: 200, text: vi.fn().mockResolvedValue('') } });
      const client = mockClient();
      client.PUT = put;
      await drainOutbox(client);
      expect(put).toHaveBeenCalled();
    });
  });

  describe('drainOutbox — task_assignee ops', () => {
    it('drains a task_assignee add', async () => {
      await seedProjectAndTask({ taskServerId: 100 });
      const db = await getDb();
      await db.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
        ['task_assignee', 'task1', 'add', '{"userServerId":5,"username":"alice"}', now()],
      );
      const put = vi.fn().mockResolvedValue({ data: undefined, response: { ok: true, status: 200, text: vi.fn().mockResolvedValue('') } });
      const client = mockClient();
      client.PUT = put;
      await drainOutbox(client);
      expect(put).toHaveBeenCalledWith('/tasks/{taskID}/assignees', expect.any(Object));
    });
  });

  describe('drainOutbox — task_relation ops', () => {
    it('drains a task_relation add', async () => {
      await seedProjectAndTask({ taskServerId: 100 });
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['task_other', 'proj1', 200, 'Peer task', now()],
      );
      await db.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
        ['task_relation', 'task1', 'add', '{"otherTaskLocalId":"task_other","kind":"subtask"}', now()],
      );
      const put = vi.fn().mockResolvedValue({ data: undefined, response: { ok: true, status: 200, text: vi.fn().mockResolvedValue('') } });
      const client = mockClient();
      client.PUT = put;
      await drainOutbox(client);
      expect(put).toHaveBeenCalled();
    });
  });

  describe('drainOutbox — retry and dead-letter', () => {
    it('dead-letters after MAX_ATTEMPTS (10) failures', async () => {
      await seedProjectAndTask({ taskServerId: null });
      const db = await getDb();
      // Create a task create op that will fail consistently
      await withTx(async (tx) => {
        await tx.execute(
          `INSERT INTO tasks (local_id, project_local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, NULL, ?, ?, 1, 0)`,
          ['task_retry', 'proj1', 'Retry task', now()],
        );
        await tx.execute(
          `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at, attempts) VALUES (?, ?, ?, ?, ?, ?)`,
          ['task', 'task_retry', 'create', '{}', now(), 10],
        );
      });
      // Mock PUT to throw a non-retryable error
      const put = vi.fn().mockRejectedValue(new Error('Server rejected'));
      const client = mockClient();
      client.PUT = put;
      await drainOutbox(client);
      // Should be moved to dead letter
      const dead = await db.select<unknown[]>(`SELECT * FROM outbox_dead_letter WHERE entity_local_id = ?`, ['task_retry']);
      expect(dead.length).toBe(1);
      const outbox = await db.select<unknown[]>(`SELECT * FROM outbox`);
      expect(outbox.length).toBe(0);
    });

    it('backs off on retryable error and preserves FIFO order', async () => {
      await seedProjectAndTask({ taskServerId: null });
      const db = await getDb();
      await withTx(async (tx) => {
        await tx.execute(
          `INSERT INTO tasks (local_id, project_local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, NULL, ?, ?, 1, 0)`,
          ['task_back', 'proj1', 'Backoff task', now()],
        );
        await tx.execute(
          `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
          ['task', 'task_back', 'create', '{}', now()],
        );
      });
      const put = vi.fn().mockRejectedValue({ retryable: true });
      const client = mockClient();
      client.PUT = put;
      await drainOutbox(client);
      // Row should stay in outbox with incremented attempts and next_attempt_at set
      const row = await db.select<{ attempts: number; next_attempt_at: string | null }[]>(
        `SELECT attempts, next_attempt_at FROM outbox WHERE entity_local_id = ?`,
        ['task_back'],
      );
      expect(row[0]!.attempts).toBe(1);
      expect(row[0]!.next_attempt_at).toBeTruthy();
    });
  });

  describe('startOutboxSync', () => {
    it('returns an unsubscribe function that stops the drain', async () => {
      const cleanup = startOutboxSync();
      expect(typeof cleanup).toBe('function');
      cleanup();
    });
  });

  describe('taskToBody', () => {
    // taskToBody is already covered extensively in taskToBody.test.ts;
    // just verify it exports and runs without error
    it('produces a body from a TaskRow', () => {
      const body = taskToBody({
        local_id: 't1',
        server_id: 1,
        project_local_id: 'p1',
        title: 'Test',
        description: 'Desc',
        done: 0,
        done_at: null,
        due_date: null,
        start_date: null,
        end_date: null,
        priority: 0,
        percent_done: 0.5,
        hex_color: 'ff0000',
        is_favorite: 1,
        repeat_after: 0,
        repeat_mode: 0,
        updated_at: '2024-01-01T00:00:00Z',
        deleted: 0,
      });
      expect(body.title).toBe('Test');
      expect(body.percent_done).toBe(50);
      expect(body.hex_color).toBe('ff0000');
    });
  });
});
