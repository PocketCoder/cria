import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import {
  listTasksForProject,
  getTaskByLocalId,
  listTasksWithDueDate,
  listFavoriteTasks,
  listTasksForLabel,
  searchTasks,
  duplicateTask,
  moveTask,
  listActiveTaskCounts,
  createTask,
  deleteTask,
} from '@/db/tasks';

const now = () => new Date().toISOString();

describe('db/tasks', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  let projectId: string;
  beforeEach(async () => {
    projectId = await seedProject(1, 'Project');
  });

  describe('listTasksForProject', () => {
    it('returns empty for a project with no tasks', async () => {
      const tasks = await listTasksForProject(projectId);
      expect(tasks).toEqual([]);
    });

    it('returns tasks ordered by done, position, due_date, title', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, done, due_date, position, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        ['t1', projectId, 'Zed', 0, null, 2048, now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, done, due_date, position, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        ['t2', projectId, 'Alpha', 0, null, 0, now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, done, due_date, position, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        ['t3', projectId, 'Done task', 1, null, 0, now()],
      );
      const tasks = await listTasksForProject(projectId);
      // done tasks last, then by position (null last), then title
      expect(tasks.map((t) => t.localId)).toEqual(['t2', 't1', 't3']);
    });

    it('excludes deleted tasks', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 1)`,
        ['t_del', projectId, 'Deleted', now()],
      );
      const tasks = await listTasksForProject(projectId);
      expect(tasks).toEqual([]);
    });
  });

  describe('getTaskByLocalId', () => {
    it('returns null for unknown local_id', async () => {
      const t = await getTaskByLocalId('nope');
      expect(t).toBeNull();
    });

    it('returns the task when it exists', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['t1', projectId, 'My task', now()],
      );
      const t = await getTaskByLocalId('t1');
      expect(t).not.toBeNull();
      expect(t!.title).toBe('My task');
      expect(t!.projectLocalId).toBe(projectId);
    });

    it('returns null for deleted task', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 1)`,
        ['t_del', projectId, 'Deleted', now()],
      );
      expect(await getTaskByLocalId('t_del')).toBeNull();
    });
  });

  describe('listTasksWithDueDate', () => {
    it('returns non-done, non-deleted tasks with due_date across projects', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, due_date, done, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, ?, 0, 0)`,
        ['t1', projectId, 'Due later', '2026-06-10T00:00:00Z', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, due_date, done, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, ?, 0, 0)`,
        ['t2', projectId, 'Due sooner', '2026-06-05T00:00:00Z', now()],
      );
      const tasks = await listTasksWithDueDate();
      expect(tasks.map((t) => t.localId)).toEqual(['t2', 't1']);
      expect(tasks[0]!.projectTitle).toBe('Project');
    });

    it('excludes done, deleted, and tasks without due_date', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, due_date, done, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 1, ?, 0, 0)`,
        ['t_done', projectId, 'Done', '2026-06-01T00:00:00Z', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, due_date, done, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, ?, 0, 1)`,
        ['t_del', projectId, 'Deleted', '2026-06-01T00:00:00Z', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['t_no_date', projectId, 'No date', now()],
      );
      expect(await listTasksWithDueDate()).toHaveLength(0);
    });
  });

  describe('listFavoriteTasks', () => {
    it('returns non-done favorited tasks', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, is_favorite, done, updated_at, dirty, deleted) VALUES (?, ?, ?, 1, 0, ?, 0, 0)`,
        ['t_fav', projectId, 'Favorite', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, is_favorite, done, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0, ?, 0, 0)`,
        ['t_not', projectId, 'Not fav', now()],
      );
      const tasks = await listFavoriteTasks();
      expect(tasks.map((t) => t.localId)).toEqual(['t_fav']);
    });
  });

  describe('listTasksForLabel', () => {
    it('returns tasks that have a given label', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['label1', 1, 'bug', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['t_label', projectId, 'Labeled task', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['t_no_label', projectId, 'No label', now()],
      );
      await db.execute(
        `INSERT INTO task_labels (task_local_id, label_local_id, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`,
        ['t_label', 'label1', now()],
      );
      const tasks = await listTasksForLabel('label1');
      expect(tasks.map((t) => t.localId)).toEqual(['t_label']);
    });
  });

  describe('searchTasks', () => {
    it('returns tasks matching text via FTS5', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, description, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['t_fts1', projectId, 'unique search term', 'description', now()],
      );
      // FTS trigger populates on INSERT
      const results = await searchTasks({ text: 'unique' });
      expect(results.map((t) => t.localId)).toContain('t_fts1');
    });

    it('returns all tasks when text is empty', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['t1', projectId, 'Task A', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['t2', projectId, 'Task B', now()],
      );
      const results = await searchTasks({ text: '' });
      expect(results.length).toBe(2);
    });

    it('filters by dueDateEnd', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, due_date, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['t_early', projectId, 'Early', '2026-06-01T00:00:00Z', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, due_date, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['t_late', projectId, 'Late', '2026-06-30T00:00:00Z', now()],
      );
      const results = await searchTasks({ text: '', dueDateEnd: '2026-06-15' });
      expect(results.map((t) => t.localId)).toEqual(['t_early']);
    });

    it('filters by priority', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, priority, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['t_high', projectId, 'High pri', 5, now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, priority, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['t_low', projectId, 'Low pri', 1, now()],
      );
      const results = await searchTasks({ text: '', priority: 5 });
      expect(results.map((t) => t.localId)).toEqual(['t_high']);
    });

    it('filters by labelTitle', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['lbl1', 1, 'urgent', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['t_lbl', projectId, 'Labeled', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['t_no', projectId, 'Not labeled', now()],
      );
      await db.execute(
        `INSERT INTO task_labels (task_local_id, label_local_id, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`,
        ['t_lbl', 'lbl1', now()],
      );
      const results = await searchTasks({ text: '', labelTitle: 'urgent' });
      expect(results.map((t) => t.localId)).toEqual(['t_lbl']);
    });
  });

  describe('createTask', () => {
    it('creates a task and returns it with a local_id', async () => {
      const t = await createTask({
        projectLocalId: projectId,
        title: 'New task',
      });
      expect(t.localId).toBeTruthy();
      expect(t.title).toBe('New task');
      expect(t.projectLocalId).toBe(projectId);
      expect(t.serverId).toBeNull();
    });

    it('accepts optional fields', async () => {
      const t = await createTask({
        projectLocalId: projectId,
        title: 'Full task',
        description: 'desc',
        dueDate: '2026-07-01T00:00:00Z',
        startDate: '2026-06-25T00:00:00Z',
        endDate: '2026-07-02T00:00:00Z',
        priority: 3,
        percentDone: 0.5,
        hexColor: '#00ff00',
        isFavorite: true,
        repeatAfter: 86400,
        repeatMode: 1,
      });
      expect(t.description).toBe('desc');
      expect(t.dueDate).toBe('2026-07-01T00:00:00Z');
      expect(t.startDate).toBe('2026-06-25T00:00:00Z');
      expect(t.endDate).toBe('2026-07-02T00:00:00Z');
      expect(t.priority).toBe(3);
      expect(t.percentDone).toBe(50);
      expect(t.hexColor).toBe('#00ff00');
      expect(t.isFavorite).toBe(true);
      expect(t.repeatAfter).toBe(86400);
      expect(t.repeatMode).toBe(1);
    });
  });

  describe('duplicateTask', () => {
    it('returns null for non-existent task', async () => {
      const dup = await duplicateTask('nonexistent');
      expect(dup).toBeNull();
    });

    it('duplicates a task into the same project', async () => {
      const original = await createTask({
        projectLocalId: projectId,
        title: 'Original',
        description: 'copy me',
        priority: 3,
      });
      const dup = await duplicateTask(original.localId);
      expect(dup).not.toBeNull();
      expect(dup!.title).toBe(original.title);
      expect(dup!.description).toBe(original.description);
      expect(dup!.priority).toBe(original.priority);
      expect(dup!.localId).not.toBe(original.localId);
    });
  });

  describe('moveTask', () => {
    it('moves a task to a different project', async () => {
      const otherProject = await seedProject(2, 'Other project');
      const t = await createTask({
        projectLocalId: projectId,
        title: 'Movable',
      });
      const moved = await moveTask(t.localId, otherProject);
      expect(moved.projectLocalId).toBe(otherProject);
    });
  });

  describe('listActiveTaskCounts', () => {
    it('returns counts of non-done, non-deleted tasks per project', async () => {
      const p2 = await seedProject(2, 'Project 2');
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, done, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, ?, 0, 0)`,
        ['t_a', projectId, 'Active', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, done, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, ?, 0, 0)`,
        ['t_b', projectId, 'Also active', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, done, updated_at, dirty, deleted) VALUES (?, ?, ?, 1, ?, 0, 0)`,
        ['t_c', projectId, 'Done', now()],
      );
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, done, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, ?, 0, 0)`,
        ['t_d', p2, 'In p2', now()],
      );
      const counts = await listActiveTaskCounts();
      expect(counts.get(projectId)).toBe(2);
      expect(counts.get(p2)).toBe(1);
    });
  });

  describe('deleteTask', () => {
    it('is idempotent on non-existent task', async () => {
      await expect(deleteTask('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('task row mapping', () => {
    it('maps percentDone correctly (0-1 to percentage)', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, percent_done, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['t_pct', projectId, 'Pct', 0.3, now()],
      );
      const t = await getTaskByLocalId('t_pct');
      expect(t!.percentDone).toBe(30);
    });

    it('normalises hexColor with leading #', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, hex_color, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0, 0)`,
        ['t_col', projectId, 'Color', 'ff0000', now()],
      );
      const t = await getTaskByLocalId('t_col');
      expect(t!.hexColor).toBe('#ff0000');
    });

    it('converts isFavorite/isSubscribed from integers', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, is_favorite, is_subscribed, updated_at, dirty, deleted) VALUES (?, ?, ?, 1, 1, ?, 0, 0)`,
        ['t_bool', projectId, 'Bools', now()],
      );
      const t = await getTaskByLocalId('t_bool');
      expect(t!.isFavorite).toBe(true);
      expect(t!.isSubscribed).toBe(true);
    });
  });
});
