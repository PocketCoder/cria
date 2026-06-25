import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import { pullProjects, pullTasksForProject, pullAllTasks, pullLabels, pullAll } from '@/sync/pull';

function mockGet(responseData: unknown[], totalPages = 1, status = 200) {
  return vi.fn().mockResolvedValue({
    data: responseData,
    response: {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map(Object.entries({ 'x-pagination-total-pages': String(totalPages) })),
      text: vi.fn().mockResolvedValue(''),
    },
  });
}

function mockClient(overrides?: { get?: ReturnType<typeof vi.fn> }) {
  return {
    GET: overrides?.get ?? mockGet([]),
    PUT: vi.fn().mockResolvedValue({ data: { id: 1 }, response: { ok: true, status: 200 } }),
    POST: vi.fn().mockResolvedValue({ data: { updated: new Date().toISOString() }, response: { ok: true, status: 200 } }),
    DELETE: vi.fn().mockResolvedValue({ data: undefined, response: { ok: true, status: 204 } }),
  } as any;
}

const now = () => new Date().toISOString();

describe('sync/pull', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  describe('pullProjects', () => {
    it('pulls projects and inserts them into the DB', async () => {
      const client = mockClient({
        get: mockGet([
          { id: 1, title: 'Project A', updated: now(), is_archived: false, is_favorite: false, position: 0 },
          { id: 2, title: 'Project B', updated: now(), is_archived: false, is_favorite: true, hex_color: 'ff0000', position: 1024 },
        ]),
      });
      const count = await pullProjects(client);
      expect(count).toBe(2);
      const db = await getDb();
      const rows = await db.select<{ title: string; server_id: number }[]>(
        `SELECT title, server_id FROM projects WHERE deleted = 0 ORDER BY title ASC`,
      );
      expect(rows.map((r) => r.title)).toEqual(['Project A', 'Project B']);
    });

    it('skips projects with invalid schema', async () => {
      const client = mockClient({
        get: mockGet([
          { id: 1, title: 'Valid', updated: now() },
          { id: 2, no_title: true, updated: now() },
          null,
        ]),
      });
      const count = await pullProjects(client);
      expect(count).toBe(1);
    });

    it('paginates through multiple pages', async () => {
      const get = vi.fn()
        .mockResolvedValueOnce({
          data: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, title: `P1-${i}`, updated: now(), is_archived: false })),
          response: {
            ok: true, status: 200,
            headers: new Map(Object.entries({ 'x-pagination-total-pages': '2' })),
            text: vi.fn().mockResolvedValue(''),
          },
        })
        .mockResolvedValueOnce({
          data: Array.from({ length: 10 }, (_, i) => ({ id: 51 + i, title: `P2-${i}`, updated: now(), is_archived: false })),
          response: {
            ok: true, status: 200,
            headers: new Map(Object.entries({ 'x-pagination-total-pages': '2' })),
            text: vi.fn().mockResolvedValue(''),
          },
        });
      const client = mockClient({ get });
      const count = await pullProjects(client);
      expect(count).toBe(60);
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('throws on HTTP error', async () => {
      const client = mockClient({
        get: mockGet([], 1, 500),
      });
      await expect(pullProjects(client)).rejects.toThrow('HTTP 500');
    });

    it('re-links parent projects on second pass', async () => {
      const db = await getDb();
      const client = mockClient({
        get: mockGet([
          { id: 2, title: 'Child', parent_project_id: 1, updated: now(), is_archived: false },
          { id: 1, title: 'Parent', updated: now(), is_archived: false },
        ]),
      });
      await pullProjects(client);
      const rows = await db.select<{ title: string; parent_local_id: string | null }[]>(
        `SELECT p.title, p2.local_id AS parent_local_id
           FROM projects p LEFT JOIN projects p2 ON p.parent_local_id = p2.local_id
          WHERE p.server_id = 2`,
      );
      // On the first pass, child's parent is inserted after parent,
      // but the re-link pass catches it. With 2 items (no page boundary),
      // both go through the first pass in order; on the second pass,
      // only projects with parent_project_id get re-upserted.
      // The exact test: parent_local_id should NOT be null.
      // (We can't assert the string because the local IDs are allocated
      // inside the function.)
      expect(rows[0]!.parent_local_id).toBeTruthy();
    });
  });

  describe('pullTasksForProject', () => {
    it('pulls tasks for a project and inserts them', async () => {
      const projLocalId = await seedProject(10, 'Test project');
      const client = mockClient({
        get: mockGet([
          {
            id: 101, project_id: 10, title: 'Task 1', done: false, priority: 0,
            percent_done: 0, is_favorite: false, repeat_after: 0, repeat_mode: 0,
            updated: now(),
          },
        ]),
      });
      const count = await pullTasksForProject(10, client);
      expect(count).toBe(1);
      const db = await getDb();
      const tasks = await db.select<{ title: string }[]>(
        `SELECT title FROM tasks WHERE project_local_id = ? AND deleted = 0`,
        [projLocalId],
      );
      expect(tasks[0]!.title).toBe('Task 1');
    });

    it('skips tasks whose project is not synced locally (count still reflects API response)', async () => {
      const client = mockClient({
        get: mockGet([
          {
            id: 201, project_id: 999, title: 'Orphan', done: false, priority: 0,
            percent_done: 0, is_favorite: false, repeat_after: 0, repeat_mode: 0,
            updated: now(),
          },
        ]),
      });
      const count = await pullTasksForProject(999, client);
      // pullTasksForProject returns collected.length (API items), not upserted count
      expect(count).toBe(1);
    });

    it('paginates through task pages', async () => {
      await seedProject(20, 'Paged project');
      const task1 = { id: 301, project_id: 20, title: 'P1-T1', done: false, priority: 0, percent_done: 0, is_favorite: false, repeat_after: 0, repeat_mode: 0, updated: now() };
      const task2 = { id: 302, project_id: 20, title: 'P2-T1', done: false, priority: 0, percent_done: 0, is_favorite: false, repeat_after: 0, repeat_mode: 0, updated: now() };
      // First page returns 50 items (matching PER_PAGE) to avoid the batch-length break
      const page1 = Array.from({ length: 50 }, (_, i) => ({ ...task1, id: 301 + i, title: `P1-${i}` }));
      const get = vi.fn()
        .mockResolvedValueOnce({
          data: page1,
          response: {
            ok: true, status: 200,
            headers: new Map(Object.entries({ 'x-pagination-total-pages': '2' })),
            text: vi.fn().mockResolvedValue(''),
          },
        })
        .mockResolvedValueOnce({
          data: [task2],
          response: {
            ok: true, status: 200,
            headers: new Map(Object.entries({ 'x-pagination-total-pages': '2' })),
            text: vi.fn().mockResolvedValue(''),
          },
        });
      const client = mockClient({ get });
      const count = await pullTasksForProject(20, client);
      expect(count).toBe(51);
    });

    it('includes updated filter when tasks_synced_at is set', async () => {
      const db = await getDb();
      await db.execute(
        `UPDATE sync_state SET tasks_synced_at = '2026-06-20T12:00:00Z' WHERE id = 1`,
      );
      const projLocal = await seedProject(42, 'Delta project');
      // A local task must exist for the delta filter to apply: with an empty
      // tasks table, tasksDeltaFilter self-heals to a full pull (no `updated`),
      // recovering from a poisoned watermark.
      await db.execute(
        `INSERT INTO tasks (local_id, server_id, project_local_id, title, updated_at, dirty, deleted)
         VALUES ('delta_seed_1', 9001, ?, 'Seed', '2026-06-19T00:00:00Z', 0, 0)`,
        [projLocal],
      );
      const get = vi.fn().mockResolvedValue({
        data: [],
        response: {
          ok: true, status: 200,
          headers: new Map(Object.entries({ 'x-pagination-total-pages': '1' })),
          text: vi.fn().mockResolvedValue(''),
        },
      });
      const client = mockClient({ get });
      await pullTasksForProject(42, client);
      const calledWith = get.mock.calls[0]?.[1] as any;
      expect(calledWith?.params?.query?.filter).toMatch(/project_id = 42/);
      expect(calledWith?.params?.query?.filter).toMatch(/updated > '/);
    });
  });

  describe('pullAllTasks', () => {
    it('pulls all tasks without project filter', async () => {
      await seedProject(30, 'All tasks project');
      const client = mockClient({
        get: mockGet([
          {
            id: 401, project_id: 30, title: 'Global task', done: false,
            priority: 0, percent_done: 0, is_favorite: false,
            repeat_after: 0, repeat_mode: 0, updated: now(),
          },
        ]),
      });
      const count = await pullAllTasks(client);
      expect(count).toBe(1);
    });

    it('includes updated filter in query when tasks_synced_at is set', async () => {
      const db = await getDb();
      await db.execute(
        `UPDATE sync_state SET tasks_synced_at = '2026-06-20T12:00:00Z' WHERE id = 1`,
      );
      const projLocal = await seedProject(50, 'Delta all project');
      // See note in pullTasksForProject: a local task must exist or the delta
      // self-heals to a full pull.
      await db.execute(
        `INSERT INTO tasks (local_id, server_id, project_local_id, title, updated_at, dirty, deleted)
         VALUES ('delta_seed_2', 9002, ?, 'Seed', '2026-06-19T00:00:00Z', 0, 0)`,
        [projLocal],
      );
      const get = vi.fn().mockResolvedValue({
        data: [
          {
            id: 501, project_id: 50, title: 'Delta task', done: false,
            priority: 0, percent_done: 0, is_favorite: false,
            repeat_after: 0, repeat_mode: 0, updated: now(),
          },
        ],
        response: {
          ok: true, status: 200,
          headers: new Map(Object.entries({ 'x-pagination-total-pages': '1' })),
          text: vi.fn().mockResolvedValue(''),
        },
      });
      const client = mockClient({ get });
      await pullAllTasks(client);
      const calledWith = get.mock.calls[0]?.[1] as any;
      expect(calledWith?.params?.query?.filter).toMatch(/^updated > '/);
    });
  });

  describe('pullLabels', () => {
    it('pulls labels and inserts them', async () => {
      const client = mockClient({
        get: mockGet([
          { id: 1, title: 'bug', updated: now() },
          { id: 2, title: 'feature', description: 'A feature label', hex_color: '00ff00', updated: now() },
        ]),
      });
      const count = await pullLabels(client);
      expect(count).toBe(2);
      const db = await getDb();
      const rows = await db.select<{ title: string }[]>(
        `SELECT title FROM labels WHERE deleted = 0 ORDER BY title ASC`,
      );
      expect(rows.map((r) => r.title)).toEqual(['bug', 'feature']);
    });

    it('paginates through label pages', async () => {
      // PER_PAGE = 50; first page must have 50 items so the loop continues
      const page1 = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, title: `L${i}`, updated: now() }));
      const get = vi.fn()
        .mockResolvedValueOnce({
          data: page1,
          response: {
            ok: true, status: 200,
            headers: new Map(Object.entries({ 'x-pagination-total-pages': '2' })),
            text: vi.fn().mockResolvedValue(''),
          },
        })
        .mockResolvedValueOnce({
          data: [{ id: 51, title: 'Last label', updated: now() }],
          response: {
            ok: true, status: 200,
            headers: new Map(Object.entries({ 'x-pagination-total-pages': '2' })),
            text: vi.fn().mockResolvedValue(''),
          },
        });
      const client = mockClient({ get });
      const count = await pullLabels(client);
      expect(count).toBe(51);
    });
  });

  describe('pullAll', () => {
    it('calls pullProjects and returns result', async () => {
      const client = mockClient({
        get: mockGet([{ id: 1, title: 'Solo project', updated: now(), is_archived: false }]),
      });
      const result = await pullAll(client);
      expect(result.projects).toBe(1);
    });
  });
});
