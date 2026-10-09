// User-driven view mutations behind the view manager (src/db/views.ts):
// create (position after the current max), rename, reorder (midpoint and
// re-index), delete with the last-view / placeholder guards, the
// `placeholder` flag, and how each op drains to the server.

import { describe, it, beforeAll, beforeEach, afterEach, expect, vi } from 'vitest';
import { getDb } from '@/db';
import { subscribe } from '@/db/bus';
import { drainOutbox } from '@/sync/push';
import {
  createDefaultViews,
  createView,
  deleteView,
  listViewsForProject,
  reindexViews,
  replaceViewsForProjectFromServer,
  updateView,
} from '@/db/views';
import { initSchema, clearTables, seedProject } from './_helpers';

function okResponse(status = 200) {
  return { ok: true, status, headers: new Map(), text: vi.fn().mockResolvedValue('') };
}

function mockClient() {
  return {
    GET: vi.fn().mockResolvedValue({ data: [], response: okResponse() }),
    PUT: vi.fn().mockResolvedValue({ data: { id: 777 }, response: okResponse() }),
    POST: vi.fn().mockResolvedValue({ data: {}, response: okResponse() }),
    DELETE: vi.fn().mockResolvedValue({ data: undefined, response: okResponse(204) }),
  } as any;
}

/** Seed a synced project with Vikunja's four default views (ids 11–14). */
async function seedSyncedViews(projectServerId = 1): Promise<string> {
  const projectLocalId = await seedProject(projectServerId);
  await replaceViewsForProjectFromServer(projectLocalId, [
    { id: 11, title: 'List', project_id: projectServerId, view_kind: 'list', position: 100 },
    { id: 12, title: 'Gantt', project_id: projectServerId, view_kind: 'gantt', position: 200 },
    { id: 13, title: 'Table', project_id: projectServerId, view_kind: 'table', position: 300 },
    { id: 14, title: 'Kanban', project_id: projectServerId, view_kind: 'kanban', position: 400 },
  ] as any);
  return projectLocalId;
}

async function outboxRows() {
  const db = await getDb();
  return db.select<{ entity_local_id: string; op: string; payload: string }[]>(
    `SELECT entity_local_id, op, payload FROM outbox WHERE entity_type = 'view' ORDER BY id`,
  );
}

describe('view mutations (view manager data layer)', () => {
  let notified: string[];
  let unsubs: Array<() => void>;

  beforeAll(initSchema);
  beforeEach(async () => {
    await clearTables();
    notified = [];
    unsubs = [
      subscribe('views', () => notified.push('views')),
      subscribe('outbox', () => notified.push('outbox')),
    ];
  });
  afterEach(() => unsubs.forEach((u) => u()));

  describe('placeholder flag', () => {
    it('marks seeded defaults as placeholders and server views as not', async () => {
      const projectLocalId = await seedProject(5);
      const seeded = await createDefaultViews(projectLocalId);
      expect(seeded.every((v) => v.placeholder)).toBe(true);

      await replaceViewsForProjectFromServer(projectLocalId, [
        { id: 51, title: 'List', project_id: 5, view_kind: 'list', position: 100 },
      ] as any);
      const views = await listViewsForProject(projectLocalId);
      expect(views).toHaveLength(1);
      expect(views[0]!.placeholder).toBe(false);
    });

    it('does not mark a pending local create as a placeholder', async () => {
      const projectLocalId = await seedProject(6);
      await createDefaultViews(projectLocalId);
      const created = await createView(projectLocalId, { title: 'Mine', viewKind: 'table' });
      expect(created.serverId).toBeNull();
      expect(created.placeholder).toBe(false);
    });
  });

  describe('createView', () => {
    it('positions a new view after the current max and queues a create', async () => {
      const projectLocalId = await seedSyncedViews();
      notified = [];

      const created = await createView(projectLocalId, { title: 'Roadmap', viewKind: 'gantt' });
      expect(created.position).toBe(400 + 1024);
      expect(created.bucketConfigurationMode).toBe('none');

      const views = await listViewsForProject(projectLocalId);
      expect(views.at(-1)!.localId).toBe(created.localId);

      expect(await outboxRows()).toEqual([
        expect.objectContaining({ entity_local_id: created.localId, op: 'create' }),
      ]);
      expect(notified).toEqual(expect.arrayContaining(['views', 'outbox']));
    });

    it('defaults a new kanban view to manual buckets, like the server', async () => {
      const projectLocalId = await seedSyncedViews();
      const created = await createView(projectLocalId, { title: 'Board 2', viewKind: 'kanban' });
      expect(created.bucketConfigurationMode).toBe('manual');
    });

    it('pushes the create with its position and stamps the server id', async () => {
      const projectLocalId = await seedSyncedViews();
      const created = await createView(projectLocalId, { title: 'Roadmap', viewKind: 'gantt' });

      const client = mockClient();
      await drainOutbox(client);

      expect(client.PUT).toHaveBeenCalledWith(
        '/projects/{project}/views',
        expect.objectContaining({
          params: { path: { project: 1 } },
          body: expect.objectContaining({ title: 'Roadmap', view_kind: 'gantt', position: 1424 }),
        }),
      );
      const views = await listViewsForProject(projectLocalId);
      expect(views.find((v) => v.localId === created.localId)!.serverId).toBe(777);
      expect(await outboxRows()).toHaveLength(0);
    });
  });

  describe('rename and reorder', () => {
    it('renames via updateView, queues an update and notifies', async () => {
      const projectLocalId = await seedSyncedViews();
      const [list] = await listViewsForProject(projectLocalId);
      notified = [];

      const renamed = await updateView(list!.localId, { title: 'Backlog' });
      expect(renamed.title).toBe('Backlog');
      expect(await outboxRows()).toEqual([
        expect.objectContaining({ entity_local_id: list!.localId, op: 'update' }),
      ]);
      expect(notified).toEqual(expect.arrayContaining(['views', 'outbox']));

      const client = mockClient();
      await drainOutbox(client);
      expect(client.POST).toHaveBeenCalledWith(
        '/projects/{project}/views/{id}',
        expect.objectContaining({
          params: { path: { project: 1, id: 11 } },
          body: expect.objectContaining({ title: 'Backlog', position: 100 }),
        }),
      );
    });

    it('a midpoint reorder is a single position update', async () => {
      const projectLocalId = await seedSyncedViews();
      const views = await listViewsForProject(projectLocalId);
      const kanban = views.find((v) => v.viewKind === 'kanban')!;

      await updateView(kanban.localId, { position: 150 });

      const after = await listViewsForProject(projectLocalId);
      expect(after.map((v) => v.viewKind)).toEqual(['list', 'kanban', 'gantt', 'table']);
      expect(await outboxRows()).toHaveLength(1);
    });

    it('reindexViews rewrites every position in order, one update each', async () => {
      const projectLocalId = await seedSyncedViews();
      const views = await listViewsForProject(projectLocalId);
      const reversed = views.map((v) => v.localId).reverse();
      notified = [];

      await reindexViews(reversed);

      const after = await listViewsForProject(projectLocalId);
      expect(after.map((v) => v.localId)).toEqual(reversed);
      expect(after.map((v) => v.position)).toEqual([1024, 2048, 3072, 4096]);

      const rows = await outboxRows();
      expect(rows.map((r) => r.entity_local_id)).toEqual(reversed);
      expect(rows.every((r) => r.op === 'update')).toBe(true);
      expect(notified).toEqual(expect.arrayContaining(['views', 'outbox']));
    });

    it('reindexViews with no ids is a no-op', async () => {
      await reindexViews([]);
      expect(await outboxRows()).toHaveLength(0);
      expect(notified).toEqual([]);
    });
  });

  describe('deleteView', () => {
    it('soft-deletes, queues a delete and notifies', async () => {
      const projectLocalId = await seedSyncedViews();
      const gantt = (await listViewsForProject(projectLocalId)).find((v) => v.viewKind === 'gantt')!;
      notified = [];

      await deleteView(gantt.localId);

      const after = await listViewsForProject(projectLocalId);
      expect(after.map((v) => v.viewKind)).toEqual(['list', 'table', 'kanban']);
      expect(await outboxRows()).toEqual([
        expect.objectContaining({ entity_local_id: gantt.localId, op: 'delete' }),
      ]);
      expect(notified).toEqual(expect.arrayContaining(['views', 'outbox']));

      const client = mockClient();
      await drainOutbox(client);
      expect(client.DELETE).toHaveBeenCalledWith(
        '/projects/{project}/views/{id}',
        expect.objectContaining({ params: { path: { project: 1, id: 12 } } }),
      );
    });

    it('refuses to delete the last view', async () => {
      const projectLocalId = await seedProject(2);
      await replaceViewsForProjectFromServer(projectLocalId, [
        { id: 21, title: 'List', project_id: 2, view_kind: 'list', position: 100 },
      ] as any);
      const [only] = await listViewsForProject(projectLocalId);

      await expect(deleteView(only!.localId)).rejects.toThrow(/at least one view/);
      expect(await listViewsForProject(projectLocalId)).toHaveLength(1);
      expect(await outboxRows()).toHaveLength(0);
    });

    it('refuses to delete a local placeholder', async () => {
      const projectLocalId = await seedProject(3);
      const [first] = await createDefaultViews(projectLocalId);

      await expect(deleteView(first!.localId)).rejects.toThrow(/not synced/);
      expect(await listViewsForProject(projectLocalId)).toHaveLength(4);
      expect(await outboxRows()).toHaveLength(0);
    });

    it('allows deleting a pending local create, which then never reaches the server', async () => {
      const projectLocalId = await seedSyncedViews();
      const created = await createView(projectLocalId, { title: 'Oops', viewKind: 'list' });

      await deleteView(created.localId);
      expect((await listViewsForProject(projectLocalId)).map((v) => v.localId)).not.toContain(
        created.localId,
      );

      const client = mockClient();
      await drainOutbox(client);
      expect(client.PUT).not.toHaveBeenCalled();
      expect(client.DELETE).not.toHaveBeenCalled();
      expect(await outboxRows()).toHaveLength(0);
    });

    it('is a no-op for an unknown view', async () => {
      await deleteView('does-not-exist');
      expect(await outboxRows()).toHaveLength(0);
    });
  });
});
