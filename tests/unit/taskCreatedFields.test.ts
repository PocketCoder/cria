// Verifies created/createdBy are persisted + read back. Guards the
// hand-edited INSERT/UPDATE column lists in db/tasks.ts (placeholder counts
// are easy to misalign).

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initSchema, clearTables, seedProject } from './_helpers';
import { upsertTaskFromServer, createTask, listTasksForProject } from '@/db/tasks';

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

  it('createTask stamps createdAt locally', async () => {
    const proj = await seedProject(3);
    const created = await createTask({ title: 'Local', projectLocalId: proj });
    expect(created.createdAt).not.toBeNull();
    expect(created.createdById).toBeNull(); // unknown until synced
  });
});
