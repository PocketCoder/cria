import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables } from './_helpers';
import {
  replaceTaskAttachmentsFromServer,
  listAttachmentsForTask,
  upsertAttachmentLocal,
  deleteAttachmentLocal,
  listTaskLocalIdsWithAttachments,
} from '@/db/attachments';

const now = () => new Date().toISOString();

describe('db/attachments', () => {
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
      ['task1', 'proj1', 'Task with att', now()],
    );
    await db.execute(
      `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
      ['task2', 'proj1', 'Task no att', now()],
    );
  }

  describe('replaceTaskAttachmentsFromServer', () => {
    it('replaces all attachments for a task', async () => {
      await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_attachments (task_local_id, server_id, file_name, created_at) VALUES (?, ?, ?, ?)`,
        ['task1', 99, 'old.txt', now()],
      );
      await replaceTaskAttachmentsFromServer('task1', [
        { id: 1, file: { id: 10, name: 'doc.pdf', size: 1024, mime: 'application/pdf' }, created: '2026-06-01T00:00:00Z' },
        { id: 2, file: { id: 20, name: 'img.png', size: 2048, mime: 'image/png' }, created: '2026-06-02T00:00:00Z' },
      ] as any);
      const atts = await listAttachmentsForTask('task1');
      expect(atts.map((a) => a.fileName)).toEqual(['doc.pdf', 'img.png']);
      expect(atts[0]!.fileId).toBe(10);
      expect(atts[0]!.fileSize).toBe(1024);
      expect(atts[0]!.mime).toBe('application/pdf');
    });
  });

  describe('listAttachmentsForTask', () => {
    it('returns empty for task with no attachments', async () => {
      await seedProjectAndTask();
      expect(await listAttachmentsForTask('task1')).toEqual([]);
    });

    it('returns attachments ordered by created_at then server_id', async () => {
      await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_attachments (task_local_id, server_id, file_name, created_at) VALUES (?, ?, ?, ?)`,
        ['task1', 1, 'a.txt', '2026-01-02T00:00:00Z'],
      );
      await db.execute(
        `INSERT INTO task_attachments (task_local_id, server_id, file_name, created_at) VALUES (?, ?, ?, ?)`,
        ['task1', 2, 'b.txt', '2026-01-01T00:00:00Z'],
      );
      const atts = await listAttachmentsForTask('task1');
      expect(atts.map((a) => a.fileName)).toEqual(['b.txt', 'a.txt']);
    });
  });

  describe('upsertAttachmentLocal', () => {
    it('inserts or replaces an attachment and notifies', async () => {
      await seedProjectAndTask();
      await upsertAttachmentLocal('task1', {
        id: 1,
        file: { id: 100, name: 'uploaded.png', size: 500, mime: 'image/png' },
        created: '2026-07-01T00:00:00Z',
      } as any);
      const atts = await listAttachmentsForTask('task1');
      expect(atts[0]!.fileName).toBe('uploaded.png');
    });
  });

  describe('deleteAttachmentLocal', () => {
    it('removes a single attachment', async () => {
      await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_attachments (task_local_id, server_id, file_name, created_at) VALUES (?, ?, ?, ?)`,
        ['task1', 1, 'keep.txt', now()],
      );
      await db.execute(
        `INSERT INTO task_attachments (task_local_id, server_id, file_name, created_at) VALUES (?, ?, ?, ?)`,
        ['task1', 2, 'remove.txt', now()],
      );
      await deleteAttachmentLocal('task1', 2);
      const atts = await listAttachmentsForTask('task1');
      expect(atts.map((a) => a.fileName)).toEqual(['keep.txt']);
    });
  });

  describe('listTaskLocalIdsWithAttachments', () => {
    it('returns deduplicated task local_ids that have attachments', async () => {
      await seedProjectAndTask();
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_attachments (task_local_id, server_id, file_name, created_at) VALUES (?, ?, ?, ?)`,
        ['task1', 1, 'a.pdf', now()],
      );
      await db.execute(
        `INSERT INTO task_attachments (task_local_id, server_id, file_name, created_at) VALUES (?, ?, ?, ?)`,
        ['task1', 2, 'b.pdf', now()],
      );
      const ids = await listTaskLocalIdsWithAttachments();
      expect(ids).toEqual(['task1']);
    });

    it('returns empty when no task has attachments', async () => {
      await seedProjectAndTask();
      expect(await listTaskLocalIdsWithAttachments()).toEqual([]);
    });
  });
});
