import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import { createTask } from '@/db/tasks';
import { getProjectTaskStats } from '@/db/projects';

describe('getProjectTaskStats', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  it('counts open and done tasks for one project only', async () => {
    const a = await seedProject(1, 'A');
    const b = await seedProject(2, 'B');
    await createTask({ projectLocalId: a, title: 'open' });
    const done = await createTask({ projectLocalId: a, title: 'done' });
    await createTask({ projectLocalId: b, title: 'other' });
    const db = await getDb();
    await db.execute('UPDATE tasks SET done = 1 WHERE local_id = ?', [done.localId]);

    expect(await getProjectTaskStats(a)).toEqual({ open: 1, done: 1 });
    expect(await getProjectTaskStats(b)).toEqual({ open: 1, done: 0 });
  });

  it('returns zeros for an empty project', async () => {
    const a = await seedProject(1, 'A');
    expect(await getProjectTaskStats(a)).toEqual({ open: 0, done: 0 });
  });
});
