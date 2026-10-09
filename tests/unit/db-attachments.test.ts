import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables } from './_helpers';
import {
  ATTACHMENT_ENTITY,
  ATTACHMENT_UPLOAD_OP,
  replaceTaskAttachmentsFromServer,
  listAttachmentsForTask,
  deleteAttachmentLocal,
  listTaskLocalIdsWithAttachments,
  insertPendingAttachment,
  finaliseAttachmentUpload,
  discardPendingAttachment,
  getAttachmentByLocalId,
  listUploadedAttachments,
  listMissingAttachments,
  type AttachmentUploadPayload,
} from '@/db/attachments';

const now = () => new Date().toISOString();
const URL_7 = 'https://vik.example/api/v1/tasks/42/attachments/7';

function payload(overrides: Partial<AttachmentUploadPayload> = {}): AttachmentUploadPayload {
  return {
    taskLocalId: 'task1',
    attachmentLocalId: 'att1',
    fileName: 'photo.png',
    mime: 'image/png',
    size: 3,
    bytesPath: 'att1',
    ...overrides,
  };
}

async function insertMirror(localId: string, taskLocalId: string, serverId: number, name: string, created = now()) {
  const db = await getDb();
  await db.execute(
    `INSERT INTO task_attachments (local_id, task_local_id, server_id, file_name, created_at) VALUES (?, ?, ?, ?, ?)`,
    [localId, taskLocalId, serverId, name, created],
  );
}

describe('db/attachments', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  async function seedProjectAndTask(opts: { taskServerId?: number | null; description?: string | null; dirty?: number } = {}) {
    const db = await getDb();
    await db.execute(
      `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
      ['proj1', 1, 'Project', now()],
    );
    await db.execute(
      `INSERT INTO tasks (local_id, server_id, project_local_id, title, description, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      ['task1', opts.taskServerId ?? null, 'proj1', 'Task with att', opts.description ?? null, now(), opts.dirty ?? 0],
    );
    await db.execute(
      `INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
      ['task2', 'proj1', 'Task no att', now()],
    );
  }

  async function outbox() {
    const db = await getDb();
    return db.select<{ entity_type: string; entity_local_id: string; op: string; payload: string }[]>(
      `SELECT entity_type, entity_local_id, op, payload FROM outbox ORDER BY id`,
    );
  }

  describe('replaceTaskAttachmentsFromServer', () => {
    it('replaces the mirrored set for a task', async () => {
      await seedProjectAndTask();
      await insertMirror('old', 'task1', 99, 'old.txt');
      await replaceTaskAttachmentsFromServer('task1', [
        { id: 1, file: { id: 10, name: 'doc.pdf', size: 1024, mime: 'application/pdf' }, created: '2026-06-01T00:00:00Z' },
        { id: 2, file: { id: 20, name: 'img.png', size: 2048, mime: 'image/png' }, created: '2026-06-02T00:00:00Z' },
      ] as any);
      const atts = await listAttachmentsForTask('task1');
      expect(atts.map((a) => a.fileName)).toEqual(['doc.pdf', 'img.png']);
      expect(atts[0]!.fileId).toBe(10);
      expect(atts[0]!.fileSize).toBe(1024);
      expect(atts[0]!.mime).toBe('application/pdf');
      expect(atts.every((a) => !a.pending)).toBe(true);
    });

    it('keeps the local id of an attachment that is still on the server', async () => {
      await seedProjectAndTask();
      await insertMirror('keep-me', 'task1', 1, 'old-name.txt');
      await replaceTaskAttachmentsFromServer('task1', [
        { id: 1, file: { id: 10, name: 'new-name.txt' }, created: '2026-06-01T00:00:00Z' },
      ] as any);
      const atts = await listAttachmentsForTask('task1');
      expect(atts).toHaveLength(1);
      expect(atts[0]).toMatchObject({ localId: 'keep-me', serverId: 1, fileName: 'new-name.txt' });
    });

    it('leaves pending uploads alone, even when the server set is empty', async () => {
      await seedProjectAndTask();
      await insertPendingAttachment(payload());
      await insertMirror('gone', 'task1', 5, 'gone.txt');
      await replaceTaskAttachmentsFromServer('task1', []);
      const atts = await listAttachmentsForTask('task1');
      expect(atts.map((a) => a.localId)).toEqual(['att1']);
      expect(atts[0]!.pending).toBe(true);
    });
  });

  describe('listAttachmentsForTask', () => {
    it('returns empty for task with no attachments', async () => {
      await seedProjectAndTask();
      expect(await listAttachmentsForTask('task1')).toEqual([]);
    });

    it('returns attachments ordered by created_at then server_id', async () => {
      await seedProjectAndTask();
      await insertMirror('a', 'task1', 1, 'a.txt', '2026-01-02T00:00:00Z');
      await insertMirror('b', 'task1', 2, 'b.txt', '2026-01-01T00:00:00Z');
      const atts = await listAttachmentsForTask('task1');
      expect(atts.map((a) => a.fileName)).toEqual(['b.txt', 'a.txt']);
    });

    it('flags a pending row as failed once its upload op has left the outbox', async () => {
      await seedProjectAndTask();
      await insertPendingAttachment(payload());
      expect((await listAttachmentsForTask('task1'))[0]).toMatchObject({ pending: true, uploadFailed: false });

      const db = await getDb();
      await db.execute(`DELETE FROM outbox`);
      expect((await listAttachmentsForTask('task1'))[0]).toMatchObject({ pending: true, uploadFailed: true });
    });
  });

  describe('insertPendingAttachment', () => {
    it('inserts a pending row and an upload op carrying the payload', async () => {
      await seedProjectAndTask();
      await insertPendingAttachment(payload());

      const [att] = await listAttachmentsForTask('task1');
      expect(att).toMatchObject({
        localId: 'att1',
        serverId: null,
        fileName: 'photo.png',
        fileSize: 3,
        mime: 'image/png',
        pending: true,
      });

      const ops = await outbox();
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        entity_type: ATTACHMENT_ENTITY,
        entity_local_id: 'att1',
        op: ATTACHMENT_UPLOAD_OP,
      });
      expect(JSON.parse(ops[0]!.payload)).toEqual(payload());

      expect(await getAttachmentByLocalId('att1')).toMatchObject({
        taskLocalId: 'task1',
        pending: true,
        bytesPath: 'att1',
        serverId: null,
      });
    });
  });

  describe('finaliseAttachmentUpload', () => {
    const uploaded = {
      id: 7,
      file: { id: 70, name: 'photo.png', size: 3, mime: 'image/png' },
      created: '2026-07-01T00:00:00Z',
    } as any;

    it('turns the pending row into a server mirror', async () => {
      await seedProjectAndTask({ taskServerId: 42 });
      await insertPendingAttachment(payload());
      await finaliseAttachmentUpload({ attachmentLocalId: 'att1', taskLocalId: 'task1', uploaded, url: URL_7 });

      const [att] = await listAttachmentsForTask('task1');
      expect(att).toMatchObject({ localId: 'att1', serverId: 7, fileId: 70, pending: false, uploadFailed: false });
      expect((await getAttachmentByLocalId('att1'))!.bytesPath).toBeNull();
      expect(await listUploadedAttachments(['att1', 'nope'])).toEqual([
        { localId: 'att1', serverId: 7, taskServerId: 42 },
      ]);
    });

    it('drops a mirror a pull inserted between the upload and now', async () => {
      await seedProjectAndTask({ taskServerId: 42 });
      await insertPendingAttachment(payload());
      await replaceTaskAttachmentsFromServer('task1', [uploaded]);
      expect(await listAttachmentsForTask('task1')).toHaveLength(2);

      await finaliseAttachmentUpload({ attachmentLocalId: 'att1', taskLocalId: 'task1', uploaded, url: URL_7 });
      const atts = await listAttachmentsForTask('task1');
      expect(atts.map((a) => a.localId)).toEqual(['att1']);
    });

    it('rewrites a dirty description in place, leaving the queued op to push it', async () => {
      const html = '<p><img src="#" data-src="cria://pending/att1"></p>';
      await seedProjectAndTask({ taskServerId: 42, description: html, dirty: 1 });
      await insertPendingAttachment(payload());
      await finaliseAttachmentUpload({ attachmentLocalId: 'att1', taskLocalId: 'task1', uploaded, url: URL_7 });

      const db = await getDb();
      const [task] = await db.select<{ description: string; dirty: number }[]>(
        `SELECT description, dirty FROM tasks WHERE local_id = 'task1'`,
      );
      expect(task!.description).toBe(`<p><img src="#" data-src="${URL_7}"></p>`);
      expect((await outbox()).filter((o) => o.entity_type === 'task')).toEqual([]);
    });

    it('queues a task update when the placeholder was already pushed', async () => {
      const html = '<p><img src="#" data-src="cria://pending/att1"></p>';
      await seedProjectAndTask({ taskServerId: 42, description: html, dirty: 0 });
      await insertPendingAttachment(payload());
      await finaliseAttachmentUpload({ attachmentLocalId: 'att1', taskLocalId: 'task1', uploaded, url: URL_7 });

      const db = await getDb();
      const [task] = await db.select<{ description: string; dirty: number }[]>(
        `SELECT description, dirty FROM tasks WHERE local_id = 'task1'`,
      );
      expect(task!.dirty).toBe(1);
      const taskOps = (await outbox()).filter((o) => o.entity_type === 'task');
      expect(taskOps).toHaveLength(1);
      expect(taskOps[0]!.op).toBe('update');
      expect(JSON.parse(taskOps[0]!.payload).description).toContain(URL_7);
    });

    it('rewrites comments that reference the upload', async () => {
      await seedProjectAndTask({ taskServerId: 42 });
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_comments (local_id, server_id, task_local_id, comment, updated_at, dirty, deleted)
         VALUES ('c-new', 0, 'task1', '<img data-src="cria://pending/att1">', ?, 1, 0),
                ('c-old', 5, 'task1', '<img data-src="cria://pending/att1">', ?, 0, 0),
                ('c-other', 6, 'task1', '<img data-src="cria://pending/att10">', ?, 0, 0)`,
        [now(), now(), now()],
      );
      await insertPendingAttachment(payload());
      await finaliseAttachmentUpload({ attachmentLocalId: 'att1', taskLocalId: 'task1', uploaded, url: URL_7 });

      const rows = await db.select<{ local_id: string; comment: string; dirty: number }[]>(
        `SELECT local_id, comment, dirty FROM task_comments ORDER BY local_id`,
      );
      expect(rows).toEqual([
        { local_id: 'c-new', comment: `<img data-src="${URL_7}">`, dirty: 1 },
        { local_id: 'c-old', comment: `<img data-src="${URL_7}">`, dirty: 1 },
        // `att10` merely starts with `att1`; it must not be touched.
        { local_id: 'c-other', comment: '<img data-src="cria://pending/att10">', dirty: 0 },
      ]);
      const commentOps = (await outbox()).filter((o) => o.entity_type === 'task_comment');
      expect(commentOps.map((o) => [o.entity_local_id, o.op])).toEqual([['c-old', 'update']]);
    });
  });

  describe('discardPendingAttachment', () => {
    it('removes the row, its op and any dead letter, returning the bytes key', async () => {
      await seedProjectAndTask();
      await insertPendingAttachment(payload());
      const db = await getDb();
      await db.execute(
        `INSERT INTO outbox_dead_letter (entity_type, entity_local_id, op, payload, attempts, failed_at)
         VALUES (?, 'att1', ?, '{}', 10, ?)`,
        [ATTACHMENT_ENTITY, ATTACHMENT_UPLOAD_OP, now()],
      );

      expect(await discardPendingAttachment('att1')).toBe('att1');
      expect(await listAttachmentsForTask('task1')).toEqual([]);
      expect(await outbox()).toEqual([]);
      expect(await db.select(`SELECT * FROM outbox_dead_letter`)).toEqual([]);
    });

    it('never removes an uploaded attachment', async () => {
      await seedProjectAndTask();
      await insertMirror('m1', 'task1', 3, 'kept.txt');
      expect(await discardPendingAttachment('m1')).toBeNull();
      expect(await listAttachmentsForTask('task1')).toHaveLength(1);
    });

    it('strips the placeholder image from the description as a user edit', async () => {
      const html = '<p>Look:</p><p><img src="#" data-src="cria://pending/att1"></p>';
      await seedProjectAndTask({ taskServerId: 42, description: html, dirty: 0 });
      await insertPendingAttachment(payload());

      await discardPendingAttachment('att1');

      const db = await getDb();
      const [task] = await db.select<{ description: string; dirty: number }[]>(
        `SELECT description, dirty FROM tasks WHERE local_id = 'task1'`,
      );
      expect(task).toEqual({ description: '<p>Look:</p><p></p>', dirty: 1 });
      const ops = await outbox();
      expect(ops.map((o) => [o.entity_type, o.entity_local_id, o.op])).toEqual([
        ['task', 'task1', 'update'],
      ]);
      expect(JSON.parse(ops[0]!.payload)).toEqual({ description: '<p>Look:</p><p></p>' });
    });

    it('strips the placeholder from other tasks that copied it, but not deleted ones', async () => {
      const html = '<img src="#" data-src="cria://pending/att1">';
      await seedProjectAndTask({ taskServerId: 42, description: '<p>none</p>' });
      const db = await getDb();
      await db.execute(`UPDATE tasks SET description = ? WHERE local_id = 'task2'`, [html]);
      await db.execute(
        `INSERT INTO tasks (local_id, project_local_id, title, description, updated_at, dirty, deleted)
         VALUES ('task3', 'proj1', 'Gone', ?, ?, 1, 1)`,
        [html, now()],
      );
      await insertPendingAttachment(payload());

      await discardPendingAttachment('att1');

      const rows = await db.select<{ local_id: string; description: string }[]>(
        `SELECT local_id, description FROM tasks ORDER BY local_id`,
      );
      expect(rows).toEqual([
        { local_id: 'task1', description: '<p>none</p>' },
        { local_id: 'task2', description: '<p></p>' },
        { local_id: 'task3', description: html },
      ]);
      expect((await outbox()).map((o) => [o.entity_local_id, o.op])).toEqual([['task2', 'update']]);
    });

    it('strips the placeholder from comments, queueing an update only for synced ones', async () => {
      await seedProjectAndTask({ taskServerId: 42 });
      const db = await getDb();
      await db.execute(
        `INSERT INTO task_comments (local_id, server_id, task_local_id, comment, updated_at, dirty, deleted)
         VALUES ('c-new', 0, 'task1', '<p>hi</p><img data-src="cria://pending/att1">', ?, 1, 0),
                ('c-old', 5, 'task1', '<img data-src="cria://pending/att1">', ?, 0, 0),
                ('c-other', 6, 'task1', '<img data-src="cria://pending/att10">', ?, 0, 0),
                ('c-gone', 7, 'task1', '<img data-src="cria://pending/att1">', ?, 1, 1)`,
        [now(), now(), now(), now()],
      );
      await insertPendingAttachment(payload());

      await discardPendingAttachment('att1');

      const rows = await db.select<{ local_id: string; comment: string; dirty: number }[]>(
        `SELECT local_id, comment, dirty FROM task_comments ORDER BY local_id`,
      );
      expect(rows).toEqual([
        { local_id: 'c-gone', comment: '<img data-src="cria://pending/att1">', dirty: 1 },
        { local_id: 'c-new', comment: '<p>hi</p>', dirty: 1 },
        // Only the image was there: an empty paragraph, never an empty
        // comment (Vikunja requires the field).
        { local_id: 'c-old', comment: '<p></p>', dirty: 1 },
        { local_id: 'c-other', comment: '<img data-src="cria://pending/att10">', dirty: 0 },
      ]);
      // c-new hasn't synced: its queued create carries the stripped text.
      const commentOps = (await outbox()).filter((o) => o.entity_type === 'task_comment');
      expect(commentOps.map((o) => [o.entity_local_id, o.op])).toEqual([['c-old', 'update']]);
    });

    it('leaves comments of a task being deleted alone', async () => {
      await seedProjectAndTask({ taskServerId: 42 });
      const db = await getDb();
      await db.execute(`UPDATE tasks SET deleted = 1, dirty = 1 WHERE local_id = 'task1'`);
      await db.execute(
        `INSERT INTO task_comments (local_id, server_id, task_local_id, comment, updated_at, dirty, deleted)
         VALUES ('c1', 5, 'task1', '<img data-src="cria://pending/att1">', ?, 0, 0)`,
        [now()],
      );
      await insertPendingAttachment(payload());

      await discardPendingAttachment('att1');

      expect(await outbox()).toEqual([]);
    });

    it('does not strip references to an attachment that has uploaded', async () => {
      const html = '<img data-src="cria://pending/m1">';
      await seedProjectAndTask({ taskServerId: 42, description: html });
      await insertMirror('m1', 'task1', 3, 'kept.png');

      await discardPendingAttachment('m1');

      const db = await getDb();
      const [task] = await db.select<{ description: string }[]>(
        `SELECT description FROM tasks WHERE local_id = 'task1'`,
      );
      expect(task!.description).toBe(html);
      expect(await outbox()).toEqual([]);
    });
  });

  describe('listMissingAttachments', () => {
    it('returns the ids that have no row at all', async () => {
      await seedProjectAndTask();
      await insertPendingAttachment(payload());
      await insertMirror('m1', 'task1', 3, 'kept.txt');
      expect(await listMissingAttachments(['att1', 'm1', 'gone'])).toEqual(['gone']);
      expect(await listMissingAttachments([])).toEqual([]);
    });
  });

  describe('deleteAttachmentLocal', () => {
    it('removes a single attachment', async () => {
      await seedProjectAndTask();
      await insertMirror('k', 'task1', 1, 'keep.txt');
      await insertMirror('r', 'task1', 2, 'remove.txt');
      await deleteAttachmentLocal('task1', 2);
      const atts = await listAttachmentsForTask('task1');
      expect(atts.map((a) => a.fileName)).toEqual(['keep.txt']);
    });
  });

  describe('listTaskLocalIdsWithAttachments', () => {
    it('returns deduplicated task local_ids that have attachments', async () => {
      await seedProjectAndTask();
      await insertMirror('a', 'task1', 1, 'a.pdf');
      await insertMirror('b', 'task1', 2, 'b.pdf');
      const ids = await listTaskLocalIdsWithAttachments();
      expect(ids).toEqual(['task1']);
    });

    it('counts a pending upload', async () => {
      await seedProjectAndTask();
      await insertPendingAttachment(payload({ taskLocalId: 'task2' }));
      expect(await listTaskLocalIdsWithAttachments()).toEqual(['task2']);
    });

    it('returns empty when no task has attachments', async () => {
      await seedProjectAndTask();
      expect(await listTaskLocalIdsWithAttachments()).toEqual([]);
    });
  });

  describe('getAttachmentByLocalId', () => {
    it('returns null for an unknown id', async () => {
      expect(await getAttachmentByLocalId('missing')).toBeNull();
    });
  });
});
