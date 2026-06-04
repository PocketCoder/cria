import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import { reconcileDeletions } from '@/sync/reconcile';

function mockGet(ids: number[], totalPages = 1) {
  return vi.fn().mockResolvedValue({
    data: ids.map((id) => ({ id })),
    response: {
      ok: true,
      status: 200,
      headers: new Map(Object.entries({ 'x-pagination-total-pages': String(totalPages) })),
      text: vi.fn().mockResolvedValue(''),
    },
  });
}

function mockClient(overrides?: { get?: ReturnType<typeof vi.fn> }) {
  return {
    GET: overrides?.get ?? mockGet([]),
    PUT: vi.fn().mockResolvedValue({ data: {}, response: { ok: true, status: 200 } }),
    POST: vi.fn().mockResolvedValue({ data: {}, response: { ok: true, status: 200 } }),
    DELETE: vi.fn().mockResolvedValue({ data: undefined, response: { ok: true, status: 204 } }),
  } as any;
}

const now = () => new Date().toISOString();

describe('sync/reconcile', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  describe('reconcileDeletions', () => {
    it('deletes local tasks and projects that no longer exist on the server', async () => {
      const db = await getDb();
      // Seed two projects: one that exists on the server, one that doesn't
      const projKeepLocalId = await seedProject(1, 'Keep');
      await db.execute(
        `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['proj_del', 2, 'Delete me', now()],
      );
      // Seed tasks under each project
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['task_keep', projKeepLocalId, 10, 'Keep task', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['task_del', 'proj_del', 20, 'Delete task', now()],
      );
      // Mock API to only return ids 1 (project) and 10 (task)
      const get = vi.fn()
        .mockResolvedValueOnce({
          data: [{ id: 10 }],
          response: {
            ok: true, status: 200,
            headers: new Map(Object.entries({ 'x-pagination-total-pages': '1' })),
            text: vi.fn().mockResolvedValue(''),
          },
        })
        .mockResolvedValueOnce({
          data: [{ id: 1 }],
          response: {
            ok: true, status: 200,
            headers: new Map(Object.entries({ 'x-pagination-total-pages': '1' })),
            text: vi.fn().mockResolvedValue(''),
          },
        });
      const client = mockClient({ get });
      await reconcileDeletions(client);
      // Task with server_id 20 should be gone; task 10 should remain
      const remainingTasks = await db.select<{ local_id: string }[]>(
        `SELECT local_id FROM tasks ORDER BY local_id`,
      );
      expect(remainingTasks.map((r) => r.local_id)).toEqual(['task_keep']);
      // Project with server_id 2 should be gone; project 1 should remain
      const remainingProjects = await db.select<{ local_id: string }[]>(
        `SELECT local_id FROM projects ORDER BY local_id`,
      );
      expect(remainingProjects.map((r) => r.local_id)).toEqual([projKeepLocalId]);
      // sync_state and other tables
      const state = await db.select<unknown[]>(`SELECT * FROM sync_state`);
      expect(state.length).toBe(1);
    });

    it('deletes task_relations for removed tasks', async () => {
      const db = await getDb();
      const projLocalId = await seedProject(1, 'P');
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['task_del', projLocalId, 50, 'Going away', now()],
      );
      await db.execute(
        `INSERT INTO task_relations (task_local_id, other_task_local_id, relation_kind) VALUES (?, ?, ?)`,
        ['task_del', 'nonexistent', 'subtask'],
      );
      const get = vi.fn()
        .mockResolvedValueOnce({
          data: [], // no tasks returned → task_del should be deleted
          response: {
            ok: true, status: 200,
            headers: new Map(Object.entries({ 'x-pagination-total-pages': '1' })),
            text: vi.fn().mockResolvedValue(''),
          },
        })
        .mockResolvedValueOnce({
          data: [{ id: 1 }],
          response: {
            ok: true, status: 200,
            headers: new Map(Object.entries({ 'x-pagination-total-pages': '1' })),
            text: vi.fn().mockResolvedValue(''),
          },
        });
      const client = mockClient({ get });
      await reconcileDeletions(client);
      // Relations for the deleted task should be cleaned up
      const relations = await db.select<unknown[]>(`SELECT * FROM task_relations`);
      expect(relations).toEqual([]);
    });

    it('handles API error without crashing', async () => {
      const db = await getDb();
      await seedProject(1, 'Survivor');
      const get = vi.fn()
        .mockResolvedValueOnce({
          data: undefined,
          response: { ok: false, status: 500, headers: new Map(), text: vi.fn().mockResolvedValue('') },
        } as any)
        .mockResolvedValueOnce({
          data: [{ id: 1 }],
          response: { ok: true, status: 200, headers: new Map(), text: vi.fn().mockResolvedValue('') },
        } as any);
      const client = mockClient({ get });
      await expect(reconcileDeletions(client)).resolves.toBeUndefined();
      // Project should still exist
      const rows = await db.select<unknown[]>(`SELECT * FROM projects WHERE server_id = 1`);
      expect(rows.length).toBe(1);
    });
  });
});
