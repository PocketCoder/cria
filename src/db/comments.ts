import { nanoid } from 'nanoid';
import { exec, getDb, withTx } from './index';
import type { CommentResponse } from '@/domain/comment';

export interface TaskComment {
  localId: string;
  serverId: number;
  taskLocalId: string;
  comment: string;
  authorName: string | null;
  authorServerId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  read: boolean;
  syncedAt: string | null;
  dirty: boolean;
  deleted: boolean;
}

interface CommentRow {
  local_id: string;
  server_id: number;
  task_local_id: string;
  comment: string;
  author_server_id: number | null;
  author_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  read: number;
  synced_at: string | null;
  dirty: number;
  deleted: number;
}

/**
 * Replace the local mirror of a task's comments with the server's set.
 * Read-only sync path — silent (no notify). Preserves the `read` flag
 * for comments that already exist locally so re-sync doesn't reset
 * read state.
 */
export async function replaceTaskCommentsFromServer(
  taskLocalId: string,
  comments: CommentResponse[],
): Promise<void> {
  await withTx(async (tx) => {
    const [{ dirty } = { dirty: 0 }] = await tx.select<{ dirty: number }[]>(
      `SELECT dirty FROM tasks WHERE local_id = ? LIMIT 1`,
      [taskLocalId],
    );
    if (dirty === 1) return;

    const existing = await tx.select<
      { server_id: number; read: number }[]
    >(
      `SELECT server_id, read FROM task_comments WHERE task_local_id = ?`,
      [taskLocalId],
    );
    const existingRead = new Map<number, boolean>();
    for (const r of existing) {
      existingRead.set(r.server_id, r.read === 1);
    }

    await tx.execute(
      `DELETE FROM task_comments WHERE task_local_id = ?`,
      [taskLocalId],
    );
    const now = new Date().toISOString();
    for (const c of comments) {
      if (!c.comment) continue;
      const author = c.author;
      const read = existingRead.get(c.id) ?? false;
      await tx.execute(
        `INSERT INTO task_comments
           (local_id, server_id, task_local_id, comment,
            author_server_id, author_name, created_at, updated_at,
            read, synced_at, dirty, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        [
          nanoid(),
          c.id,
          taskLocalId,
          c.comment,
          author?.id ?? null,
          author?.name ?? author?.username ?? null,
          c.created ?? null,
          c.updated ?? null,
          read ? 1 : 0,
          now,
        ],
      );
    }
  });
}

export async function listCommentsForTask(
  taskLocalId: string,
): Promise<TaskComment[]> {
  const db = await getDb();
  const rows = await db.select<CommentRow[]>(
    `SELECT local_id, server_id, task_local_id, comment,
            author_server_id, author_name, created_at, updated_at,
            read, synced_at, dirty, deleted
       FROM task_comments
      WHERE task_local_id = ? AND deleted = 0
      ORDER BY created_at ASC, server_id ASC`,
    [taskLocalId],
  );
  return rows.map(rowToComment);
}

export async function markCommentsAsRead(
  taskLocalId: string,
): Promise<void> {
  await exec(
    `UPDATE task_comments SET read = 1
      WHERE task_local_id = ? AND read = 0`,
    [taskLocalId],
  );
}

export async function getCommentCountForTask(
  taskLocalId: string,
): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count FROM task_comments
      WHERE task_local_id = ? AND deleted = 0`,
    [taskLocalId],
  );
  return rows[0]?.count ?? 0;
}

export async function getUnreadCountForTask(
  taskLocalId: string,
): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count FROM task_comments
      WHERE task_local_id = ? AND read = 0 AND deleted = 0`,
    [taskLocalId],
  );
  return rows[0]?.count ?? 0;
}

function rowToComment(r: CommentRow): TaskComment {
  return {
    localId: r.local_id,
    serverId: r.server_id,
    taskLocalId: r.task_local_id,
    comment: r.comment,
    authorName: r.author_name,
    authorServerId: r.author_server_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    read: r.read === 1,
    syncedAt: r.synced_at,
    dirty: r.dirty === 1,
    deleted: r.deleted === 1,
  };
}
