// Outbox push tests for kanban entities (bucket / task_bucket) and the
// dirty-guard that keeps unsynced buckets alive across a server pull.
//
// Regression coverage for: new buckets disappearing on poll (never pushed
// + wiped by replace-from-server) and task moves not persisting to server.

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import {
  createBucket,
  setTaskBucket,
  replaceBucketsForViewFromServer,
  listBucketsForView,
  listBucketAssignmentsForView,
} from '@/db/buckets';
import { updateView, listViewsForProject } from '@/db/views';
import { drainOutbox } from '@/sync/push';
import type { ApiClient } from '@/api/client';

interface Recorded {
  method: string;
  url: string;
  params?: { path?: Record<string, unknown> };
  body?: Record<string, unknown>;
}

function recordingClient(records: Recorded[]): ApiClient {
  const ok = { ok: true, status: 200, text: async () => '' } as unknown as Response;
  const make =
    (method: string) =>
    async (url: string, opts?: { params?: { path?: Record<string, unknown> }; body?: Record<string, unknown> }) => {
      records.push({ method, url, params: opts?.params, body: opts?.body });
      return {
        data: { id: 999, updated: '2024-01-01T00:00:00Z' },
        response: ok,
      };
    };
  return {
    GET: make('GET'),
    PUT: make('PUT'),
    POST: make('POST'),
    DELETE: make('DELETE'),
  } as unknown as ApiClient;
}

const NOW = '2024-01-01T00:00:00Z';

async function seedKanbanView(opts: {
  localId: string;
  serverId: number | null;
  projectLocalId: string;
  dirty?: number;
}): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO project_views
       (local_id, server_id, project_local_id, title, view_kind, position,
        bucket_configuration_mode, updated_at, dirty, deleted)
     VALUES (?, ?, ?, 'Board', 'kanban', 0, 'manual', ?, ?, 0)`,
    [opts.localId, opts.serverId, opts.projectLocalId, NOW, opts.dirty ?? 0],
  );
}

describe('kanban outbox push', () => {
  beforeAll(async () => {
    await initSchema();
  });
  beforeEach(async () => {
    await clearTables();
  });

  it('pushes a bucket create and stamps its server id', async () => {
    const projectLocalId = await seedProject(1);
    await seedKanbanView({ localId: 'v1', serverId: 10, projectLocalId });

    const bucket = await createBucket({ title: 'Backlog', viewLocalId: 'v1' });

    const records: Recorded[] = [];
    await drainOutbox(recordingClient(records));

    const put = records.find((r) => r.method === 'PUT');
    expect(put?.url).toBe('/projects/{id}/views/{view}/buckets');
    expect(put?.params?.path).toEqual({ id: 1, view: 10 });
    expect(put?.body).toMatchObject({ title: 'Backlog' });

    const db = await getDb();
    const [row] = await db.select<{ server_id: number | null; dirty: number }[]>(
      `SELECT server_id, dirty FROM buckets WHERE local_id = ?`,
      [bucket.localId],
    );
    expect(row?.server_id).toBe(999);
    expect(row?.dirty).toBe(0);

    const outbox = await db.select<unknown[]>(`SELECT * FROM outbox`);
    expect(outbox).toHaveLength(0);
  });

  it('pushes a task-bucket assignment to the bucket/tasks endpoint', async () => {
    const projectLocalId = await seedProject(2);
    await seedKanbanView({ localId: 'v2', serverId: 20, projectLocalId });
    const db = await getDb();
    // A synced bucket + task (no outbox noise).
    await db.execute(
      `INSERT INTO buckets (local_id, server_id, view_local_id, title, position, task_limit, updated_at, dirty, deleted)
       VALUES ('b2', 200, 'v2', 'Doing', 0, 0, ?, 0, 0)`,
      [NOW],
    );
    await db.execute(
      `INSERT INTO tasks (local_id, server_id, project_local_id, title, updated_at, dirty, deleted)
       VALUES ('t2', 50, ?, 'Task', ?, 0, 0)`,
      [projectLocalId, NOW],
    );

    await setTaskBucket('t2', 'v2', 'b2');

    const records: Recorded[] = [];
    await drainOutbox(recordingClient(records));

    const post = records.find((r) => r.method === 'POST');
    expect(post?.url).toBe('/projects/{project}/views/{view}/buckets/{bucket}/tasks');
    expect(post?.params?.path).toEqual({ project: 2, view: 20, bucket: 200 });
    expect(post?.body).toMatchObject({ task_id: 50, bucket_id: 200 });

    const outbox = await db.select<unknown[]>(`SELECT * FROM outbox`);
    expect(outbox).toHaveLength(0);
  });

  it('retries (does not drop) a bucket create when the view has no server id yet', async () => {
    const projectLocalId = await seedProject(3);
    await seedKanbanView({ localId: 'v3', serverId: null, projectLocalId });

    const bucket = await createBucket({ title: 'Later', viewLocalId: 'v3' });

    const records: Recorded[] = [];
    await drainOutbox(recordingClient(records));

    // No PUT fired; the op stayed in the outbox for a later attempt.
    expect(records.find((r) => r.method === 'PUT')).toBeUndefined();
    const db = await getDb();
    const outbox = await db.select<{ attempts: number }[]>(`SELECT attempts FROM outbox`);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.attempts).toBe(1);

    const [row] = await db.select<{ server_id: number | null; deleted: number }[]>(
      `SELECT server_id, deleted FROM buckets WHERE local_id = ?`,
      [bucket.localId],
    );
    expect(row?.server_id).toBeNull();
    expect(row?.deleted).toBe(0);
  });

  it('reads task-bucket assignments back with mapped camelCase fields', async () => {
    const projectLocalId = await seedProject(5);
    await seedKanbanView({ localId: 'v5', serverId: 50, projectLocalId });
    const db = await getDb();
    await db.execute(
      `INSERT INTO buckets (local_id, server_id, view_local_id, title, position, task_limit, updated_at, dirty, deleted)
       VALUES ('b5', 500, 'v5', 'Doing', 0, 0, ?, 0, 0)`,
      [NOW],
    );
    await db.execute(
      `INSERT INTO tasks (local_id, server_id, project_local_id, title, updated_at, dirty, deleted)
       VALUES ('t5', 55, ?, 'Task', ?, 0, 0)`,
      [projectLocalId, NOW],
    );

    await setTaskBucket('t5', 'v5', 'b5');

    // Regression: the repo must map snake_case columns to the camelCase
    // domain shape — otherwise taskLocalId/bucketLocalId read back undefined
    // and the board can never place a moved card in its bucket.
    const assignments = await listBucketAssignmentsForView('v5');
    expect(assignments).toEqual([
      { taskLocalId: 't5', viewLocalId: 'v5', bucketLocalId: 'b5', position: 0 },
    ]);
  });

  it('a pull keeps a dirty (unsynced) bucket while replacing synced ones', async () => {
    const projectLocalId = await seedProject(4);
    await seedKanbanView({ localId: 'v4', serverId: 40, projectLocalId });

    // A brand-new local bucket (dirty=1, no server id) awaiting push.
    const local = await createBucket({ title: 'Local', viewLocalId: 'v4' });

    // Server pull returns a different bucket.
    await replaceBucketsForViewFromServer('v4', [
      { id: 700, title: 'Server', project_view_id: 40, position: 0 },
    ] as any);

    const buckets = await listBucketsForView('v4');
    const titles = buckets.map((b) => b.title).sort();
    expect(titles).toEqual(['Local', 'Server']);
    // The dirty local bucket is untouched.
    expect(buckets.find((b) => b.localId === local.localId)?.title).toBe('Local');
  });

  it('updateView sets the done bucket and pushes done_bucket_id', async () => {
    const projectLocalId = await seedProject(8);
    await seedKanbanView({ localId: 'v8', serverId: 80, projectLocalId });
    const db = await getDb();
    await db.execute(
      `INSERT INTO buckets (local_id, server_id, view_local_id, title, position, task_limit, updated_at, dirty, deleted)
       VALUES ('b8', 808, 'v8', 'Done', 0, 0, ?, 0, 0)`,
      [NOW],
    );

    await updateView('v8', { doneBucketServerId: 808 });

    // Persisted locally…
    const view = (await listViewsForProject(projectLocalId)).find((v) => v.localId === 'v8');
    expect(view?.doneBucketServerId).toBe(808);

    // …and pushed to the view-update endpoint with the Vikunja field names.
    const records: Recorded[] = [];
    await drainOutbox(recordingClient(records));
    const post = records.find(
      (r) => r.method === 'POST' && r.url === '/projects/{project}/views/{id}',
    );
    expect(post?.params?.path).toEqual({ project: 8, id: 80 });
    expect(post?.body).toMatchObject({ done_bucket_id: 808, default_bucket_id: 0 });
  });
});
