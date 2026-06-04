// Project-views sync + default-view fallback tests.
//
// Covers the fix for "No views available for this project.": views are now
// pulled per-project on open (pullViewsForProjectLocal), and when a project
// has none (offline / local-only), four local default views are seeded.

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import {
  listViewsForProject,
  createDefaultViews,
  replaceViewsForProjectFromServer,
} from '@/db/views';
import { listBucketsForView } from '@/db/buckets';
import { pullViewsForProjectLocal } from '@/sync/pull';
import type { ApiClient } from '@/api/client';

function okResponse() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => '',
  } as any;
}

/** Mock client that serves view + bucket GETs by route template. */
function mockClient(views: unknown[], buckets: unknown[]): ApiClient {
  return {
    GET: (async (url: string) => {
      if (url === '/projects/{project}/views') {
        return { data: views, response: okResponse() };
      }
      if (url === '/projects/{id}/views/{view}/buckets') {
        return { data: buckets, response: okResponse() };
      }
      return { data: [], response: okResponse() };
    }) as any,
  } as unknown as ApiClient;
}

describe('project views: default fallback + per-project pull', () => {
  beforeAll(async () => {
    await initSchema();
  });
  beforeEach(async () => {
    await clearTables();
  });

  it('createDefaultViews seeds four local-only views in list/gantt/table/kanban order', async () => {
    const projectLocalId = await seedProject(1);
    const views = await createDefaultViews(projectLocalId);

    expect(views.map((v) => v.viewKind)).toEqual([
      'list',
      'gantt',
      'table',
      'kanban',
    ]);

    const db = await getDb();
    const rows = await db.select<{ dirty: number; server_id: number | null }[]>(
      `SELECT dirty, server_id FROM project_views WHERE project_local_id = ?`,
      [projectLocalId],
    );
    // Local-only: never dirty, never has a server id, never queued to outbox.
    for (const r of rows) {
      expect(r.dirty).toBe(0);
      expect(r.server_id).toBeNull();
    }
    const outbox = await db.select<unknown[]>(
      `SELECT * FROM outbox WHERE entity_type = 'view'`,
    );
    expect(outbox).toHaveLength(0);

    // The kanban default uses manual bucket mode.
    const kanban = views.find((v) => v.viewKind === 'kanban')!;
    expect(kanban.bucketConfigurationMode).toBe('manual');
  });

  it('createDefaultViews is idempotent (no duplicate seeding)', async () => {
    const projectLocalId = await seedProject(2);
    await createDefaultViews(projectLocalId);
    const again = await createDefaultViews(projectLocalId);
    expect(again).toHaveLength(4);

    const db = await getDb();
    const rows = await db.select<{ c: number }[]>(
      `SELECT COUNT(*) AS c FROM project_views WHERE project_local_id = ?`,
      [projectLocalId],
    );
    expect(rows[0]?.c).toBe(4);
  });

  it('pullViewsForProjectLocal upserts server views and pulls kanban buckets', async () => {
    const projectLocalId = await seedProject(7);
    const viewPayloads = [
      { id: 100, title: 'List', project_id: 7, view_kind: 'list', position: 0 },
      { id: 101, title: 'Board', project_id: 7, view_kind: 'kanban', position: 3 },
    ];
    const bucketPayloads = [
      { id: 500, title: 'Backlog', project_view_id: 101, position: 0 },
      { id: 501, title: 'Done', project_view_id: 101, position: 1 },
    ];

    const count = await pullViewsForProjectLocal(
      projectLocalId,
      mockClient(viewPayloads, bucketPayloads),
    );
    expect(count).toBe(2);

    const views = await listViewsForProject(projectLocalId);
    expect(views.map((v) => v.viewKind)).toEqual(['list', 'kanban']);

    const kanban = views.find((v) => v.viewKind === 'kanban')!;
    const buckets = await listBucketsForView(kanban.localId);
    expect(buckets.map((b) => b.title)).toEqual(['Backlog', 'Done']);
  });

  it('pullViewsForProjectLocal is a no-op for a local-only project (no server id)', async () => {
    const db = await getDb();
    await db.execute(
      `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted)
       VALUES ('local-only', NULL, 'Local', ?, 1, 0)`,
      [new Date().toISOString()],
    );

    const count = await pullViewsForProjectLocal(
      'local-only',
      mockClient([{ id: 1, title: 'X', project_id: 99, view_kind: 'list' }], []),
    );
    expect(count).toBe(0);
    expect(await listViewsForProject('local-only')).toHaveLength(0);
  });

  it('server views replace local default fallbacks without duplicating', async () => {
    const projectLocalId = await seedProject(9);
    await createDefaultViews(projectLocalId); // 4 local-only placeholders

    await replaceViewsForProjectFromServer(projectLocalId, [
      { id: 200, title: 'List', project_id: 9, view_kind: 'list', position: 0 },
      { id: 201, title: 'Gantt', project_id: 9, view_kind: 'gantt', position: 1 },
      { id: 202, title: 'Table', project_id: 9, view_kind: 'table', position: 2 },
      { id: 203, title: 'Kanban', project_id: 9, view_kind: 'kanban', position: 3 },
    ] as any);

    const views = await listViewsForProject(projectLocalId);
    expect(views).toHaveLength(4); // not 8 — placeholders soft-deleted
    for (const v of views) {
      expect(v.serverId).not.toBeNull();
    }
  });
});
