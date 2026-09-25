import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import {
  replaceTaskCommentsFromServer,
  listCommentsForTask,
  createComment,
  updateComment,
  deleteComment,
} from '@/db/comments';
import { drainOutbox } from '@/sync/push';
import { initSchema, clearTables, seedProject } from './_helpers';

async function seedTask(serverId: number | null = 10, dirty = 0) {
  const db = await getDb();
  const proj = await seedProject(1);
  await db.execute(
    `INSERT INTO tasks (local_id, server_id, project_local_id, title, updated_at, dirty, deleted)
     VALUES ('t1', ?, ?, 'T', '2026-01-01T00:00:00Z', ?, 0)`,
    [serverId, proj, dirty],
  );
}

const srv = (id: number, comment: string) => ({
  id, comment, author: { id: 1, username: 'u' }, created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z',
});

async function rows() {
  const db = await getDb();
  return db.select<{ server_id: number; comment: string; read: number; dirty: number; deleted: number }[]>(
    `SELECT server_id, comment, read, dirty, deleted FROM task_comments ORDER BY server_id`,
  );
}

const ok = (data: unknown) => vi.fn().mockResolvedValue({ data, response: { ok: true, status: 200 } });

describe('db/comments sync', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  it('inserts, updates and removes vanished clean rows', async () => {
    await seedTask();
    await replaceTaskCommentsFromServer('t1', [srv(1, 'a'), srv(2, 'b')] as never);
    await replaceTaskCommentsFromServer('t1', [srv(2, 'b2')] as never);
    expect((await rows()).map((r) => [r.server_id, r.comment])).toEqual([[2, 'b2']]);
  });

  it('keeps the local read flag across a re-sync', async () => {
    await seedTask();
    await replaceTaskCommentsFromServer('t1', [srv(1, 'a')] as never);
    const db = await getDb();
    await db.execute(`UPDATE task_comments SET read = 1`);
    await replaceTaskCommentsFromServer('t1', [srv(1, 'a edited')] as never);
    expect((await rows())[0]).toMatchObject({ comment: 'a edited', read: 1 });
  });

  it('never overwrites or deletes a dirty local edit', async () => {
    await seedTask();
    await replaceTaskCommentsFromServer('t1', [srv(1, 'a')] as never);
    const [c] = await listCommentsForTask('t1');
    await updateComment(c!.localId, 'my edit');
    await replaceTaskCommentsFromServer('t1', [] as never);
    expect((await rows())[0]).toMatchObject({ comment: 'my edit', dirty: 1 });
  });
});

describe('comment push round-trip', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  it('create → PUT, stamps server id and clears the outbox', async () => {
    await seedTask(10);
    await createComment('t1', 'hello');
    const PUT = ok({ id: 55 });
    await drainOutbox({ PUT } as never);
    expect(PUT).toHaveBeenCalledWith('/tasks/{taskID}/comments', expect.objectContaining({
      params: { path: { taskID: 10 } }, body: { comment: 'hello' },
    }));
    expect((await rows())[0]).toMatchObject({ server_id: 55, dirty: 0 });
    const db = await getDb();
    expect(await db.select(`SELECT * FROM outbox`)).toEqual([]);
  });

  it('create then delete before sync never reaches the server', async () => {
    await seedTask(10);
    await createComment('t1', 'oops');
    const [c] = await listCommentsForTask('t1');
    await deleteComment(c!.localId);
    const PUT = ok({ id: 1 });
    const DELETE = ok(undefined);
    await drainOutbox({ PUT, DELETE } as never);
    expect(PUT).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });

  it('waits while the parent task has no server id', async () => {
    await seedTask(null);
    await createComment('t1', 'early');
    const PUT = ok({ id: 1 });
    await drainOutbox({ PUT } as never);
    expect(PUT).not.toHaveBeenCalled();
    const db = await getDb();
    expect(await db.select(`SELECT id FROM outbox WHERE entity_type = 'task_comment'`)).toHaveLength(1);
  });
});
