import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables } from './_helpers';
import {
  listLabels,
  listLabelsForTask,
  toggleTaskLabel,
  applyLabelsByTitle,
  createLabel,
  updateLabel,
  deleteLabel,
  getLabelByLocalId,
} from '@/db/labels';


const now = () => new Date().toISOString();

describe('db/labels', () => {
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
      ['task1', 'proj1', 'Task', now()],
    );
    return { projectLocalId: 'proj1', taskLocalId: 'task1' };
  }

  describe('listLabels', () => {
    it('returns empty when no labels exist', async () => {
      expect(await listLabels()).toEqual([]);
    });

    it('returns non-deleted labels ordered by title', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['l2', 2, 'Zed', now()],
      );
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['l1', 1, 'Alpha', now()],
      );
      const all = await listLabels();
      expect(all.map((l) => l.title)).toEqual(['Alpha', 'Zed']);
    });

    it('excludes deleted labels', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['l_vis', 1, 'Visible', now()],
      );
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 1)`,
        ['l_del', 2, 'Deleted', now()],
      );
      expect(await listLabels()).toHaveLength(1);
    });
  });

  describe('getLabelByLocalId', () => {
    it('returns null for unknown id', async () => {
      expect(await getLabelByLocalId('nope')).toBeNull();
    });

    it('returns the label when it exists', async () => {
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['l1', 1, 'bug', now()],
      );
      const l = await getLabelByLocalId('l1');
      expect(l).not.toBeNull();
      expect(l!.title).toBe('bug');
    });
  });

  describe('listLabelsForTask', () => {
    it('returns labels linked via task_labels', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['l_a', 1, 'Label A', now()],
      );
      await db.execute(
        `INSERT INTO task_labels (task_local_id, label_local_id, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`,
        [taskLocalId, 'l_a', now()],
      );
      const labels = await listLabelsForTask(taskLocalId);
      expect(labels.map((l) => l.title)).toEqual(['Label A']);
    });

    it('excludes deleted task_labels links', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['l_a', 1, 'A', now()],
      );
      await db.execute(
        `INSERT INTO task_labels (task_local_id, label_local_id, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 1)`,
        [taskLocalId, 'l_a', now()],
      );
      expect(await listLabelsForTask(taskLocalId)).toEqual([]);
    });
  });

  describe('toggleTaskLabel', () => {
    it('adds a label when none exists (returns true)', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['l1', 1, 'bug', now()],
      );
      const result = await toggleTaskLabel(taskLocalId, 'l1');
      expect(result).toBe(true);
      const rows = await db.select<{ deleted: number }[]>(
        `SELECT deleted FROM task_labels WHERE task_local_id = ? AND label_local_id = ?`,
        [taskLocalId, 'l1'],
      );
      expect(rows.length).toBe(1);
      expect(rows[0]!.deleted).toBe(0);
    });

    it('removes an existing label (returns false)', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['l1', 1, 'bug', now()],
      );
      await db.execute(
        `INSERT INTO task_labels (task_local_id, label_local_id, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`,
        [taskLocalId, 'l1', now()],
      );
      const result = await toggleTaskLabel(taskLocalId, 'l1');
      expect(result).toBe(false);
      const row = await db.select<{ deleted: number }[]>(
        `SELECT deleted FROM task_labels WHERE task_local_id = ? AND label_local_id = ?`,
        [taskLocalId, 'l1'],
      );
      expect(row[0]!.deleted).toBe(1);
    });

    it('re-adds a previously removed label', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['l1', 1, 'bug', now()],
      );
      await db.execute(
        `INSERT INTO task_labels (task_local_id, label_local_id, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 1)`,
        [taskLocalId, 'l1', now()],
      );
      const result = await toggleTaskLabel(taskLocalId, 'l1');
      expect(result).toBe(true);
      const row = await db.select<{ deleted: number }[]>(
        `SELECT deleted FROM task_labels WHERE task_local_id = ? AND label_local_id = ?`,
        [taskLocalId, 'l1'],
      );
      expect(row[0]!.deleted).toBe(0);
    });

    it('queues outbox entries', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['l1', 1, 'bug', now()],
      );
      await toggleTaskLabel(taskLocalId, 'l1');
      const outbox = await db.select<{ op: string }[]>(
        `SELECT op FROM outbox WHERE entity_type = 'task_label' AND entity_local_id = ?`,
        [taskLocalId],
      );
      expect(outbox.length).toBe(1);
      expect(outbox[0]!.op).toBe('add');
    });
  });

  describe('createLabel', () => {
    it('creates a label with local_id, marks dirty, queues outbox', async () => {
      const l = await createLabel({ title: 'New label', description: 'desc', hexColor: '#123' });
      expect(l.localId).toBeTruthy();
      expect(l.title).toBe('New label');
      expect(l.description).toBe('desc');
      expect(l.hexColor).toBe('#123');
      expect(l.serverId).toBeNull();
      const db = await getDb();
      const row = await db.select<{ dirty: number }[]>(
        `SELECT dirty FROM labels WHERE local_id = ?`,
        [l.localId],
      );
      expect(row[0]!.dirty).toBe(1);
    });
  });

  describe('updateLabel', () => {
    it('updates title and marks dirty', async () => {
      const l = await createLabel({ title: 'Original' });
      const updated = await updateLabel(l.localId, { title: 'Renamed' });
      expect(updated.title).toBe('Renamed');
      const db = await getDb();
      const row = await db.select<{ dirty: number }[]>(
        `SELECT dirty FROM labels WHERE local_id = ?`,
        [l.localId],
      );
      expect(row[0]!.dirty).toBe(1);
    });

    it('throws for non-existent label', async () => {
      await expect(updateLabel('nope', { title: 'x' })).rejects.toThrow('Failed to retrieve updated label nope');
    });
  });

  describe('deleteLabel', () => {
    it('soft-deletes and removes task_labels links', async () => {
      const l = await createLabel({ title: 'To delete' });
      const { taskLocalId } = await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_labels (task_local_id, label_local_id, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)`,
        [taskLocalId, l.localId, now()],
      );
      await deleteLabel(l.localId);
      const labelRow = await db.select<{ deleted: number }[]>(
        `SELECT deleted FROM labels WHERE local_id = ?`,
        [l.localId],
      );
      expect(labelRow[0]!.deleted).toBe(1);
      const links = await db.select<unknown[]>(
        `SELECT * FROM task_labels WHERE label_local_id = ?`,
        [l.localId],
      );
      expect(links.length).toBe(0);
    });
  });

  describe('applyLabelsByTitle', () => {
    it('creates new labels and applies them', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      await applyLabelsByTitle(taskLocalId, ['newlabel']);
      const labels = await listLabelsForTask(taskLocalId);
      expect(labels.map((l) => l.title)).toEqual(['newlabel']);
    });

    it('deduplicates case-insensitively', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      await applyLabelsByTitle(taskLocalId, ['tag', 'TAG', 'Tag']);
      const labels = await listLabelsForTask(taskLocalId);
      expect(labels).toHaveLength(1);
    });

    it('reuses existing labels by case-insensitive title', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO labels (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
        ['existing', 1, 'Existing', now()],
      );
      await applyLabelsByTitle(taskLocalId, ['existing']);
      const labels = await listLabelsForTask(taskLocalId);
      expect(labels[0]!.localId).toBe('existing');
    });

    it('skips empty titles', async () => {
      const { taskLocalId } = await seedProjectAndTask();
      await applyLabelsByTitle(taskLocalId, ['  ', '', 'valid']);
      const labels = await listLabelsForTask(taskLocalId);
      expect(labels.map((l) => l.title)).toEqual(['valid']);
    });
  });
});
