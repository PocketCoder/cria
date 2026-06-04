// Verifies created/createdBy are persisted + read back. Guards the
// hand-edited INSERT/UPDATE column lists in db/tasks.ts (placeholder counts
// are easy to misalign).

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import { upsertTaskFromServer, createTask, listTasksForProject } from '@/db/tasks';

const NOW = '2024-01-01T00:00:00Z';

describe('task created/createdBy fields', () => {
  beforeAll(async () => {
    await initSchema();
  });
  beforeEach(async () => {
    await clearTables();
  });

  it('surfaces created + created_by from a server upsert', async () => {
    const proj = await seedProject(1);
    await upsertTaskFromServer({
      id: 100,
      project_id: 1,
      title: 'From server',
      created: '2024-02-03T00:00:00Z',
      created_by: { id: 42 },
    } as never);

    const tasks = await listTasksForProject(proj);
    const t = tasks.find((x) => x.serverId === 100)!;
    expect(t.createdAt).toBe('2024-02-03T00:00:00Z');
    expect(t.createdById).toBe(42);
  });

  it('updates created fields on a re-upsert (UPDATE column alignment)', async () => {
    const proj = await seedProject(2);
    const base = { id: 200, project_id: 2, title: 'T' };
    await upsertTaskFromServer({ ...base, created: '2024-01-01T00:00:00Z', created_by: { id: 1 } } as never);
    await upsertTaskFromServer({ ...base, title: 'T2', created: '2024-01-05T00:00:00Z', created_by: { id: 7 } } as never);

    const t = (await listTasksForProject(proj)).find((x) => x.serverId === 200)!;
    expect(t.title).toBe('T2');
    expect(t.createdAt).toBe('2024-01-05T00:00:00Z');
    expect(t.createdById).toBe(7);
  });

  it('backfills created fields on a dirty row even though the merge UPDATE is skipped', async () => {
    const proj = await seedProject(4);
    const db = await getDb();
    // A synced-but-dirty task (pending local edit) with no created info yet.
    await db.execute(
      `INSERT INTO tasks (local_id, server_id, project_local_id, title, updated_at, created_at, created_by_id, dirty, deleted)
       VALUES ('dt', 300, ?, 'Edited locally', ?, NULL, NULL, 1, 0)`,
      [proj, NOW],
    );

    await upsertTaskFromServer({
      id: 300,
      project_id: 4,
      title: 'Server title',
      created: '2024-03-09T00:00:00Z',
      created_by: { id: 11 },
    } as never);

    const t = (await listTasksForProject(proj)).find((x) => x.serverId === 300)!;
    // Dirty-guard preserved the local title…
    expect(t.title).toBe('Edited locally');
    // …but the immutable created fields were backfilled.
    expect(t.createdAt).toBe('2024-03-09T00:00:00Z');
    expect(t.createdById).toBe(11);
  });

  it('createTask stamps createdAt locally', async () => {
    const proj = await seedProject(3);
    const created = await createTask({ title: 'Local', projectLocalId: proj });
    expect(created.createdAt).not.toBeNull();
    expect(created.createdById).toBeNull(); // unknown until synced
  });
});
