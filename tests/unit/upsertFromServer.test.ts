// Regression tests at the upsertXFromServer caller boundary.
//
// The mergeFromServer helper is exercised directly in syncMerge.test.ts;
// these tests pin the *integration* — that each per-entity caller
// passes the right contract through and respects the resulting
// dirty-guard branches. Specifically guards against the three bugs
// documented in CLAUDE.md:
//
//   1. pull resurrects locally-deleted rows
//   2. pull clobbers a dirty mid-flight edit
//   3. clean updates apply fine (sanity)

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { getDb } from '@/db';
import { upsertProjectFromServer } from '@/db/projects';
import { upsertTaskFromServer } from '@/db/tasks';
import type { ProjectResponse } from '@/domain/project';
import type { TaskResponse } from '@/domain/task';
import { initSchema, clearTables, seedProject } from './_helpers';

function projectPayload(id: number, over: Partial<ProjectResponse> = {}): ProjectResponse {
  return {
    id,
    title: `Project ${id}`,
    description: '',
    hex_color: null,
    is_archived: false,
    parent_project_id: 0,
    position: null,
    updated: new Date().toISOString(),
    created: new Date().toISOString(),
    ...over,
  } as ProjectResponse;
}

function taskPayload(id: number, projectServerId: number, over: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id,
    project_id: projectServerId,
    title: `Task ${id}`,
    description: '',
    done: false,
    priority: 0,
    percent_done: 0,
    hex_color: null,
    position: null,
    is_favorite: false,
    repeat_after: 0,
    repeat_mode: 0,
    updated: new Date().toISOString(),
    created: new Date().toISOString(),
    ...over,
  } as TaskResponse;
}

describe('upsertProjectFromServer', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  it('inserts a new project from the server', async () => {
    const id = await upsertProjectFromServer(projectPayload(10, { title: 'Inbox' }));
    const db = await getDb();
    const [row] = await db.select<{ title: string; dirty: number; deleted: number }[]>(
      `SELECT title, dirty, deleted FROM projects WHERE local_id = ?`,
      [id],
    );
    expect(row!.title).toBe('Inbox');
    expect(row!.dirty).toBe(0);
    expect(row!.deleted).toBe(0);
  });

  it('does NOT clobber a dirty local edit (PR #7 regression)', async () => {
    const id = await upsertProjectFromServer(projectPayload(20, { title: 'orig' }));
    const db = await getDb();
    // User renames locally; row goes dirty.
    await db.execute(
      `UPDATE projects SET title = ?, dirty = 1 WHERE local_id = ?`,
      ['user rename pending push', id],
    );

    // Pull races in with the unchanged server title.
    await upsertProjectFromServer(projectPayload(20, { title: 'orig' }));

    const [row] = await db.select<{ title: string; dirty: number }[]>(
      `SELECT title, dirty FROM projects WHERE local_id = ?`,
      [id],
    );
    expect(row!.title).toBe('user rename pending push');
    expect(row!.dirty).toBe(1);
  });

  it('does NOT resurrect a pending-delete (the original recurring bug)', async () => {
    const id = await upsertProjectFromServer(projectPayload(30));
    const db = await getDb();
    await db.execute(
      `UPDATE projects SET dirty = 1, deleted = 1 WHERE local_id = ?`,
      [id],
    );

    await upsertProjectFromServer(projectPayload(30));

    const [row] = await db.select<{ deleted: number }[]>(
      `SELECT deleted FROM projects WHERE local_id = ?`,
      [id],
    );
    expect(row!.deleted).toBe(1);
  });
});

describe('upsertTaskFromServer', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  it('inserts a task whose project is already synced', async () => {
    await seedProject(1, 'parent');
    const localId = await upsertTaskFromServer(taskPayload(50, 1, { title: 'new task' }));
    expect(localId).toBeTruthy();
    const db = await getDb();
    const [row] = await db.select<{ title: string; dirty: number }[]>(
      `SELECT title, dirty FROM tasks WHERE local_id = ?`,
      [localId!],
    );
    expect(row!.title).toBe('new task');
    expect(row!.dirty).toBe(0);
  });

  it('skips a task whose project is not yet synced (returns null)', async () => {
    const result = await upsertTaskFromServer(taskPayload(51, 99 /* unknown project */));
    expect(result).toBeNull();
    const db = await getDb();
    const rows = await db.select<{ local_id: string }[]>(`SELECT local_id FROM tasks`);
    expect(rows).toHaveLength(0);
  });

  it('does NOT clobber a dirty due_date edit when server payload is unchanged (PR #7 — the "date flash" bug)', async () => {
    await seedProject(2, 'parent');
    const localId = await upsertTaskFromServer(
      taskPayload(60, 2, { title: 'baseline', due_date: '2026-06-01T00:00:00Z' }),
    );
    const db = await getDb();
    await db.execute(
      `UPDATE tasks SET due_date = ?, dirty = 1 WHERE local_id = ?`,
      ['2026-12-31T00:00:00Z', localId!],
    );

    await upsertTaskFromServer(
      taskPayload(60, 2, { title: 'baseline', due_date: '2026-06-01T00:00:00Z' }),
    );

    const [row] = await db.select<{ due_date: string; dirty: number }[]>(
      `SELECT due_date, dirty FROM tasks WHERE local_id = ?`,
      [localId!],
    );
    expect(row!.due_date).toBe('2026-12-31T00:00:00Z');
    expect(row!.dirty).toBe(1);
  });

  it('does NOT resurrect a pending task delete', async () => {
    await seedProject(3, 'parent');
    const localId = await upsertTaskFromServer(taskPayload(70, 3));
    const db = await getDb();
    await db.execute(
      `UPDATE tasks SET dirty = 1, deleted = 1 WHERE local_id = ?`,
      [localId!],
    );

    await upsertTaskFromServer(taskPayload(70, 3));

    const [row] = await db.select<{ deleted: number }[]>(
      `SELECT deleted FROM tasks WHERE local_id = ?`,
      [localId!],
    );
    expect(row!.deleted).toBe(1);
  });
});
