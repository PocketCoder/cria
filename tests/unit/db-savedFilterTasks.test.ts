import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import { parseFilterQuery } from '@/lib/filterQueryParser';
import { compileFilter } from '@/lib/filterCompiler';
import { listTasksFilteredAllProjects } from '@/db/tasks';

const NOW = new Date('2026-07-09T12:00:00Z');

async function seedTask(
  localId: string,
  projectLocalId: string,
  title: string,
  opts: { priority?: number; done?: number } = {},
) {
  const db = await getDb();
  await db.execute(
    `INSERT INTO tasks (local_id, project_local_id, title, priority, done, updated_at, dirty, deleted)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
    [localId, projectLocalId, title, opts.priority ?? 0, opts.done ?? 0, new Date().toISOString()],
  );
}

describe('db/tasks listTasksFilteredAllProjects', () => {
  beforeAll(initSchema);
  beforeEach(async () => {
    await clearTables();
    const work = await seedProject(4, 'Work');
    const home = await seedProject(12, 'Home');
    await seedTask('t1', work, 'Urgent work', { priority: 4 });
    await seedTask('t2', work, 'Low work', { priority: 1 });
    await seedTask('t3', home, 'Urgent home', { priority: 5 });
    await seedTask('t4', home, 'Done urgent', { priority: 5, done: 1 });
  });

  function compiled(query: string) {
    const { ast } = parseFilterQuery(query, NOW);
    return compileFilter(ast, false);
  }

  it('applies a compiled filter across all projects', async () => {
    const { where, params } = compiled('priority >= 3 && done = false');
    const tasks = await listTasksFilteredAllProjects(false, where, params);
    expect(tasks.map((t) => t.title).sort()).toEqual(['Urgent home', 'Urgent work']);
  });

  it('includes the owning project title on each row', async () => {
    const { where, params } = compiled('priority >= 3 && done = false');
    const tasks = await listTasksFilteredAllProjects(false, where, params);
    const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t.projectTitle]));
    expect(byTitle['Urgent work']).toBe('Work');
    expect(byTitle['Urgent home']).toBe('Home');
  });

  it('pre-filters done tasks when the query does not mention done', async () => {
    const { where, params } = compiled('priority >= 3');
    const tasks = await listTasksFilteredAllProjects(true, where, params);
    expect(tasks.map((t) => t.title).sort()).toEqual(['Urgent home', 'Urgent work']);
  });

  it('returns everything with no filter', async () => {
    const tasks = await listTasksFilteredAllProjects(false);
    expect(tasks).toHaveLength(4);
  });
});
