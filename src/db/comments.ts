import { nanoid } from 'nanoid';
import { exec, getDb, withTx } from './index';
import { notify } from './bus';
import { getCachedUser } from './user';
import { createApiFetch } from '@/api/client';
import type { CommentResponse, ReactionMap } from '@/domain/comment';

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
  reactions: ReactionMap | null;
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
  reactions: string | null;
}

/**
 * Replace the local mirror of a task's comments with the server's set.
 * Read-only sync path — silent (no notify).
 *
 * Preserves locally dirty/deleted rows (the outbox is authoritative).
 * Preserves the `read` flag for clean rows. Deletes clean rows that
 * no longer exist on the server (removed by another client).
 */
export async function replaceTaskCommentsFromServer(
  taskLocalId: string,
  comments: CommentResponse[],
): Promise<void> {
  const db = await getDb();

  // Snapshot existing rows before any writes
  const existing = await db.select<{
    local_id: string;
    server_id: number;
    read: number;
    dirty: number;
    deleted: number;
  }[]>(
    `SELECT local_id, server_id, read, dirty, deleted
       FROM task_comments WHERE task_local_id = ?`,
    [taskLocalId],
  );

  const existingByServerId = new Map<number, (typeof existing)[0]>();
  for (const row of existing) {
    if (row.server_id > 0) existingByServerId.set(row.server_id, row);
  }

  const serverIds = new Set<number>();
  const now = new Date().toISOString();

  await withTx(async (tx) => {
    const [{ dirty } = { dirty: 0 }] = await tx.select<{ dirty: number }[]>(
      `SELECT dirty FROM tasks WHERE local_id = ? LIMIT 1`,
      [taskLocalId],
    );
    if (dirty === 1) return;

    for (const c of comments) {
      if (!c.comment) continue;
      serverIds.add(c.id);

      const existingRow = existingByServerId.get(c.id);
      if (existingRow && (existingRow.dirty === 1 || existingRow.deleted === 1)) {
        continue;
      }

      const author = c.author;
      const read = existingRow ? existingRow.read === 1 : false;

      const reactionsJson = c.reactions ? JSON.stringify(c.reactions) : null;

      if (existingRow) {
        await tx.execute(
          `UPDATE task_comments
              SET comment = ?, author_server_id = ?, author_name = ?,
                  created_at = ?, updated_at = ?, read = ?, synced_at = ?,
                  reactions = ?, dirty = 0, deleted = 0
            WHERE local_id = ?`,
          [
            c.comment,
            author?.id ?? null,
            author?.name ?? author?.username ?? null,
            c.created ?? null,
            c.updated ?? null,
            read ? 1 : 0,
            now,
            reactionsJson,
            existingRow.local_id,
          ],
        );
      } else {
        await tx.execute(
          `INSERT INTO task_comments
              (local_id, server_id, task_local_id, comment,
               author_server_id, author_name, created_at, updated_at,
               read, synced_at, reactions, dirty, deleted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
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
            reactionsJson,
          ],
        );
      }
    }

    // Delete clean rows the server no longer holds
    for (const row of existing) {
      if (row.dirty === 1 || row.deleted === 1) continue;
      if (row.server_id === 0) continue;
      if (!serverIds.has(row.server_id)) {
        await tx.execute(`DELETE FROM task_comments WHERE local_id = ?`, [row.local_id]);
      }
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
            read, synced_at, dirty, deleted, reactions
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

/**
 * Create a new comment for a task. Inserts a local row + outbox 'create' op.
 * Sets the author from the currently logged-in user so the name appears
 * immediately instead of showing "Unknown" until the next pull cycle.
 */
export async function createComment(
  taskLocalId: string,
  comment: string,
): Promise<void> {
  const localId = nanoid();
  const now = new Date().toISOString();

  const user = await getCachedUser();
  const authorName = user?.name ?? user?.username ?? null;
  const authorServerId = user?.serverId ?? null;

  await withTx(async (tx) => {
    await tx.execute(
      `INSERT INTO task_comments
          (local_id, server_id, task_local_id, comment,
           author_server_id, author_name, created_at, updated_at,
           read, synced_at, reactions, dirty, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, 1, 0)`,
      [localId, 0, taskLocalId, comment, authorServerId, authorName, now, now, null],
    );
    await tx.execute(
      `INSERT INTO outbox
         (entity_type, entity_local_id, op, payload, attempts, created_at)
       VALUES ('task_comment', ?, 'create', '{}', 0, ?)`,
      [localId, now],
    );
  });
  notify('comments');
}

/**
 * Update an existing comment's text. Updates row + outbox 'update' op.
 */
export async function updateComment(
  commentLocalId: string,
  comment: string,
): Promise<void> {
  const now = new Date().toISOString();
  await withTx(async (tx) => {
    await tx.execute(
      `UPDATE task_comments SET comment = ?, updated_at = ?, dirty = 1
       WHERE local_id = ? AND deleted = 0`,
      [comment, now, commentLocalId],
    );
    await tx.execute(
      `INSERT INTO outbox
         (entity_type, entity_local_id, op, payload, attempts, created_at)
       VALUES ('task_comment', ?, 'update', '{}', 0, ?)`,
      [commentLocalId, now],
    );
  });
  notify('comments');
}

/**
 * Soft-delete a comment. Sets deleted = 1 + outbox 'delete' op.
 */
export async function deleteComment(
  commentLocalId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await withTx(async (tx) => {
    await tx.execute(
      `UPDATE task_comments SET deleted = 1, updated_at = ?, dirty = 1
       WHERE local_id = ?`,
      [now, commentLocalId],
    );
    await tx.execute(
      `INSERT INTO outbox
         (entity_type, entity_local_id, op, payload, attempts, created_at)
       VALUES ('task_comment', ?, 'delete', '{}', 0, ?)`,
      [commentLocalId, now],
    );
  });
  notify('comments');
}

/**
 * Get a single comment by local id.
 */
export async function getCommentByLocalId(
  localId: string,
): Promise<TaskComment | null> {
  const db = await getDb();
  const rows = await db.select<CommentRow[]>(
    `SELECT local_id, server_id, task_local_id, comment,
            author_server_id, author_name, created_at, updated_at,
            read, synced_at, dirty, deleted, reactions
       FROM task_comments WHERE local_id = ? LIMIT 1`,
    [localId],
  );
  return rows[0] ? rowToComment(rows[0]) : null;
}

/**
 * Toggle the current user's reaction on a comment.
 * Optimistically updates the local DB, then fires the API call.
 * The next pull cycle refreshes from the server if the API failed.
 */
export async function toggleCommentReaction(
  commentLocalId: string,
  emoji: string,
): Promise<void> {
  const comment = await getCommentByLocalId(commentLocalId);
  if (!comment || comment.deleted) return;

  const user = await getCachedUser();
  const userId = user?.serverId;
  if (!userId) return;

  const currentReactions = comment.reactions ?? {};
  const reactors = currentReactions[emoji] ?? [];
  const hasReacted = reactors.some((u) => u.id === userId);

  const newReactions: ReactionMap = {};
  for (const [key, users] of Object.entries(currentReactions)) {
    newReactions[key] = [...users];
  }

  if (hasReacted) {
    newReactions[emoji] = reactors.filter((u) => u.id !== userId);
    if (newReactions[emoji].length === 0) {
      delete newReactions[emoji];
    }
  } else {
    newReactions[emoji] = [
      ...reactors,
      { id: userId, name: user?.name, username: user?.username },
    ];
  }

  // Optimistic local update
  const reactionsJson = JSON.stringify(newReactions);
  await exec(
    `UPDATE task_comments SET reactions = ? WHERE local_id = ?`,
    [reactionsJson, commentLocalId],
  );
  notify('comments');

  // Fire API call — fire-and-forget; next pull corrects on error
  const apiFetch = createApiFetch();
  if (hasReacted) {
    apiFetch(`/comments/${comment.serverId}/reactions/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: emoji }),
    }).catch((err) => {
      console.error('[toggleCommentReaction] failed to remove reaction:', err);
    });
  } else {
    apiFetch(`/comments/${comment.serverId}/reactions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: emoji }),
    }).catch((err) => {
      console.error('[toggleCommentReaction] failed to add reaction:', err);
    });
  }
}

function rowToComment(r: CommentRow): TaskComment {
  let reactions: ReactionMap | null = null;
  if (r.reactions) {
    try {
      reactions = JSON.parse(r.reactions) as ReactionMap;
    } catch {
      reactions = null;
    }
  }
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
    reactions,
  };
}
