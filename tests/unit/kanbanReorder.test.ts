import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import {
  setTaskBucket,
  updateTaskPosition,
  reorderTasksInBucket,
  listBucketAssignmentsForView,
} from '@/db/buckets';

const NOW = '2024-01-01T00:00:00Z';

describe('kanban reorder', () => {
  beforeAll(async () => {
    await initSchema();
  });
  beforeEach(async () => {
    await clearTables();
  });

  async function seedData() {
    const projectLocalId = await seedProject(1);
    const db = await getDb();
    await db.execute(
      `INSERT INTO project_views (local_id, server_id, project_local_id, title, view_kind, position, bucket_configuration_mode, updated_at, dirty, deleted)
       VALUES ('v1', 10, ?, 'Board', 'kanban', 0, 'manual', ?, 0, 0)`,
      [projectLocalId, NOW],
    );
    await db.execute(
      `INSERT INTO buckets (local_id, server_id, view_local_id, title, position, task_limit, updated_at, dirty, deleted)
       VALUES ('b1', 100, 'v1', 'Todo', 0, 0, ?, 0, 0)`,
      [NOW],
    );
    await db.execute(
      `INSERT INTO tasks (local_id, server_id, project_local_id, title, updated_at, dirty, deleted)
       VALUES ('t1', 1, ?, 'Task A', ?, 0, 0)`,
      [projectLocalId, NOW],
    );
    await db.execute(
      `INSERT INTO tasks (local_id, server_id, project_local_id, title, updated_at, dirty, deleted)
       VALUES ('t2', 2, ?, 'Task B', ?, 0, 0)`,
      [projectLocalId, NOW],
    );
    await db.execute(
      `INSERT INTO tasks (local_id, server_id, project_local_id, title, updated_at, dirty, deleted)
       VALUES ('t3', 3, ?, 'Task C', ?, 0, 0)`,
      [projectLocalId, NOW],
    );
    return { projectLocalId };
  }

  it('setTaskBucket stores position when provided', async () => {
    await seedData();
    await setTaskBucket('t1', 'v1', 'b1', 500);
    const assignments = await listBucketAssignmentsForView('v1');
    const a = assignments.find((x) => x.taskLocalId === 't1');
    expect(a?.position).toBe(500);
  });

  it('setTaskBucket defaults position to 0', async () => {
    await seedData();
    await setTaskBucket('t1', 'v1', 'b1');
    const assignments = await listBucketAssignmentsForView('v1');
    const a = assignments.find((x) => x.taskLocalId === 't1');
    expect(a?.position).toBe(0);
  });

  it('updateTaskPosition updates the position and creates outbox entry', async () => {
    await seedData();
    await setTaskBucket('t1', 'v1', 'b1');
    const db = await getDb();

    await updateTaskPosition('t1', 'v1', 2048);

    const assignments = await listBucketAssignmentsForView('v1');
    const a = assignments.find((x) => x.taskLocalId === 't1');
    expect(a?.position).toBe(2048);

    const outbox = await db.select<{ entity_type: string; payload: string }[]>(
      `SELECT entity_type, payload FROM outbox WHERE entity_local_id = 't1'`,
    );
    const pos = outbox.find((o) => o.entity_type === 'task_position');
    expect(pos).toBeDefined();
    expect(JSON.parse(pos!.payload)).toMatchObject({ view_local_id: 'v1', position: 2048 });
  });

  it('reorderTasksInBucket re-positions all tasks with even spacing', async () => {
    await seedData();
    await setTaskBucket('t1', 'v1', 'b1');
    await setTaskBucket('t2', 'v1', 'b1');
    await setTaskBucket('t3', 'v1', 'b1');

    await reorderTasksInBucket('v1', ['t3', 't1', 't2'], 2048);

    const assignments = await listBucketAssignmentsForView('v1');
    const b1Tasks = assignments.filter((a) => a.bucketLocalId === 'b1');
    expect(b1Tasks).toHaveLength(3);

    const posMap = Object.fromEntries(b1Tasks.map((a) => [a.taskLocalId, a.position]));
    expect(posMap).toEqual({ t3: 2048, t1: 4096, t2: 6144 });
  });

  it('assignments ordered by position after updates', async () => {
    await seedData();
    await setTaskBucket('t1', 'v1', 'b1', 3000);
    await setTaskBucket('t2', 'v1', 'b1', 1000);
    await setTaskBucket('t3', 'v1', 'b1', 2000);

    const assignments = await listBucketAssignmentsForView('v1');
    const b1Tasks = assignments.filter((a) => a.bucketLocalId === 'b1');
    expect(b1Tasks.map((a) => a.taskLocalId)).toEqual(['t2', 't3', 't1']);
  });
});
