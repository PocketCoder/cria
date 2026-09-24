import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import { parseFilterQuery } from '@/lib/filterQueryParser';
import { compileFilter } from '@/lib/filterCompiler';

const now = new Date('2026-07-09T12:00:00Z');

async function seedTask(localId: string, projectLocalId: string, title: string) {
  const db = await getDb();
  await db.execute(
    `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted)
     VALUES (?, ?, ?, ?, 0, 0)`,
    [localId, projectLocalId, title, new Date().toISOString()],
  );
}

async function run(query: string): Promise<string[]> {
  const { ast } = parseFilterQuery(query, now);
  const { where, params } = compileFilter(ast, false);
  const db = await getDb();
  const rows = await db.select<{ title: string }[]>(
    `SELECT title FROM tasks t WHERE t.deleted = 0 AND ${where} ORDER BY title`,
    params,
  );
  return rows.map((r) => r.title);
}

describe('filterCompiler project clause', () => {
  beforeAll(initSchema);
  beforeEach(async () => {
    await clearTables();
    const p4 = await seedProject(4, 'Work');
    const p12 = await seedProject(12, 'Home');
    await seedTask('t1', p4, 'Work task');
    await seedTask('t2', p12, 'Home task');
  });

  it('matches numeric project ids against server_id (Vikunja-web filter format)', async () => {
    expect(await run('project = 4')).toEqual(['Work task']);
    expect(await run('project in 4, 12')).toEqual(['Home task', 'Work task']);
    expect(await run('project not in 4')).toEqual(['Home task']);
    expect(await run('project != 12')).toEqual(['Work task']);
  });

  it('still matches string values against project title', async () => {
    expect(await run("project = 'Work'")).toEqual(['Work task']);
    expect(await run("project in 'Work', 'Home'")).toEqual(['Home task', 'Work task']);
  });
});
