import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import { createTask, listUndatedTasks, countTasksDoneSince } from '@/db/tasks';

describe('db summary queries', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  let projectId: string;
  beforeEach(async () => {
    projectId = await seedProject(1, 'Project');
  });

  it('listUndatedTasks returns open undated tasks, highest priority first', async () => {
    await createTask({ projectLocalId: projectId, title: 'low', priority: 1 });
    await createTask({ projectLocalId: projectId, title: 'high', priority: 4 });
    await createTask({ projectLocalId: projectId, title: 'dated', dueDate: '2026-10-20T00:00:00Z' });
    const done = await createTask({ projectLocalId: projectId, title: 'done' });
    const db = await getDb();
    await db.execute('UPDATE tasks SET done = 1 WHERE local_id = ?', [done.localId]);

    const out = await listUndatedTasks();
    expect(out.map((t) => t.title)).toEqual(['high', 'low']);
    expect(out[0]!.projectTitle).toBe('Project');
  });

  it('listUndatedTasks honours the limit', async () => {
    for (const title of ['a', 'b', 'c']) await createTask({ projectLocalId: projectId, title });
    expect(await listUndatedTasks(2)).toHaveLength(2);
  });

  it('countTasksDoneSince counts only tasks completed at or after the cutoff', async () => {
    const recent = await createTask({ projectLocalId: projectId, title: 'recent' });
    const old = await createTask({ projectLocalId: projectId, title: 'old' });
    await createTask({ projectLocalId: projectId, title: 'open' });
    const db = await getDb();
    await db.execute('UPDATE tasks SET done = 1, done_at = ? WHERE local_id = ?', [
      '2026-10-05T10:00:00.000Z',
      recent.localId,
    ]);
    await db.execute('UPDATE tasks SET done = 1, done_at = ? WHERE local_id = ?', [
      '2026-09-01T10:00:00.000Z',
      old.localId,
    ]);
    expect(await countTasksDoneSince('2026-10-03T00:00:00.000Z')).toBe(1);
    expect(await countTasksDoneSince('2026-08-01T00:00:00.000Z')).toBe(2);
  });
});
