import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables } from './_helpers';
import {
  listAssigneesForTask,
  upsertTaskAssigneesFromServer,
  addTaskAssignee,
  removeTaskAssignee,
} from '@/db/task-assignees';

const now = () => new Date().toISOString();

describe('db/task-assignees', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  async function seedProjectAndTask() {
    const db = await getDb();
    await db.execute(
      `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
      ['proj1', 1, 'Project', now()],
    );
    await db.execute(
      `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
      ['task1', 'proj1', 'My task', now()],
    );
    return { projectLocalId: 'proj1', taskLocalId: 'task1' };
  }

  describe('listAssigneesForTask', () => {
    it('returns empty for a task with no assignees', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      expect(await listAssigneesForTask(taskLocalId)).toEqual([]);
    });

    it('returns non-deleted assignees ordered by username', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_assignees (task_local_id, user_server_id, username, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        [taskLocalId, 2, 'Zara', now()],
      );
      await db.execute(
        `INSERT INTO task_assignees (task_local_id, user_server_id, username, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        [taskLocalId, 1, 'Alice', now()],
      );
      const assignees = await listAssigneesForTask(taskLocalId);
      expect(assignees.map((a) => a.username)).toEqual(['Alice', 'Zara']);
    });

    it('excludes deleted assignees', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_assignees (task_local_id, user_server_id, username, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 1)`,
        [taskLocalId, 1, 'Removed', now()],
      );
      expect(await listAssigneesForTask(taskLocalId)).toEqual([]);
    });
  });

  describe('upsertTaskAssigneesFromServer', () => {
    it('replaces all assignees for a task', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_assignees (task_local_id, user_server_id, username, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        [taskLocalId, 99, 'Old user', now()],
      );
      await upsertTaskAssigneesFromServer(taskLocalId, [
        { id: 1, username: 'Alice' },
        { id: 2, username: 'Bob' },
      ] as any);
      const assignees = await listAssigneesForTask(taskLocalId);
      expect(assignees.map((a) => a.username)).toEqual(['Alice', 'Bob']);
    });

    it('falls back from username to name', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      await upsertTaskAssigneesFromServer(taskLocalId, [
        { id: 1, name: 'Charlie' },
      ] as any);
      const assignees = await listAssigneesForTask(taskLocalId);
      expect(assignees[0]!.username).toBe('Charlie');
    });
  });

  describe('addTaskAssignee', () => {
    it('inserts a new assignee', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      await addTaskAssignee(taskLocalId, 1, 'Alice');
      const assignees = await listAssigneesForTask(taskLocalId);
      expect(assignees.map((a) => ({ userServerId: a.userServerId, username: a.username }))).toEqual([
        { userServerId: 1, username: 'Alice' },
      ]);
    });

    it('is idempotent if assignee already exists and is not deleted', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      await addTaskAssignee(taskLocalId, 1, 'Alice');
      await addTaskAssignee(taskLocalId, 1, 'Alice');
      const assignees = await listAssigneesForTask(taskLocalId);
      expect(assignees).toHaveLength(1);
    });

    it('undeletes a previously removed assignee', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_assignees (task_local_id, user_server_id, username, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 1)`,
        [taskLocalId, 1, 'Bob', now()],
      );
      await addTaskAssignee(taskLocalId, 1, 'Bob');
      const row = await db.select<{ deleted: number }[]>(
        `SELECT deleted FROM task_assignees WHERE task_local_id = ? AND user_server_id = ?`,
        [taskLocalId, 1],
      );
      expect(row[0]!.deleted).toBe(0);
    });

    it('queues an outbox entry', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      await addTaskAssignee(taskLocalId, 1, 'Alice');
      const db = await getDb();
      const outbox = await db.select<{ op: string }[]>(
        `SELECT op FROM outbox WHERE entity_type = 'task_assignee' AND entity_local_id = ?`,
        [taskLocalId],
      );
      expect(outbox[0]!.op).toBe('add');
    });
  });

  describe('removeTaskAssignee', () => {
    it('soft-deletes the assignee row', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      await addTaskAssignee(taskLocalId, 1, 'Alice');
      await removeTaskAssignee(taskLocalId, 1);
      const db = await getDb();
      const row = await db.select<{ deleted: number }[]>(
        `SELECT deleted FROM task_assignees WHERE task_local_id = ? AND user_server_id = ?`,
        [taskLocalId, 1],
      );
      expect(row[0]!.deleted).toBe(1);
    });

    it('queues an outbox entry', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      await addTaskAssignee(taskLocalId, 1, 'Alice');
      await removeTaskAssignee(taskLocalId, 1);
      const db = await getDb();
      const outbox = await db.select<{ op: string }[]>(
        `SELECT op FROM outbox WHERE entity_type = 'task_assignee' AND entity_local_id = ? AND op = 'remove'`,
        [taskLocalId],
      );
      expect(outbox.length).toBe(1);
    });
  });
});
