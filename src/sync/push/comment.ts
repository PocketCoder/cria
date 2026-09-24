import { callApi, type ApiClient } from '@/api/client';
import { withTx, type Database } from '@/db';
import { notify } from '@/db/bus';
import { ApiError } from '@/api/errors';
import { type OutboxRow, callApiIgnore404, cachedCreateResponse, cacheCreateResponse } from './shared';

export interface TaskCommentRow {
  local_id: string;
  server_id: number;
  task_local_id: string;
  comment: string;
  updated_at: string;
  deleted: number;
}

export async function executeTaskCommentOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  const localId = op.entity_local_id;

  const [row] = await db.select<TaskCommentRow[]>(
    `SELECT local_id, server_id, task_local_id, comment, deleted
       FROM task_comments WHERE local_id = ? LIMIT 1`,
    [localId],
  );
  if (!row) return;

  const [taskRow] = await db.select<{ server_id: number | null }[]>(
    `SELECT server_id FROM tasks WHERE local_id = ? LIMIT 1`,
    [row.task_local_id],
  );
  const taskServerId = taskRow?.server_id;
  if (!taskServerId) {
    throw new ApiError(408, null, 'task_comment: parent task not synced yet', true, true);
  }

  if (op.op === 'create') {
    if (row.deleted === 1) {
      await withTx(async (tx) => {
        await tx.execute('DELETE FROM task_comments WHERE local_id = ?', [localId]);
      });
      notify('comments');
      return;
    }
    if (row.server_id !== 0) return;

    const cachedId = cachedCreateResponse(op.payload);
    if (typeof cachedId === 'number') {
      await withTx(async (tx) => {
        await tx.execute(
          `UPDATE task_comments SET server_id = ?, synced_at = ?, dirty = 0 WHERE local_id = ?`,
          [cachedId, new Date().toISOString(), localId],
        );
        await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
      });
      notify('comments');
      return;
    }

    const res = await callApi(
      client.PUT('/tasks/{taskID}/comments', {
        params: { path: { taskID: taskServerId } },
        body: { comment: row.comment },
      }),
    );
    const newServerId = (res as { id?: number }).id;

    await cacheCreateResponse(op.id, op.payload, newServerId);

    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE task_comments SET server_id = ?, synced_at = ?, dirty = 0 WHERE local_id = ?`,
        [newServerId ?? 0, new Date().toISOString(), localId],
      );
      await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
    });
    notify('comments');
    return;
  }

  if (op.op === 'update') {
    if (row.server_id === 0) {
      throw new ApiError(408, null, 'Cannot update a comment without server id', true, true);
    }

    const res = await callApi(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated schema has no body for comment update
      (client.POST as any)('/tasks/{taskID}/comments/{commentID}', {
        params: { path: { taskID: taskServerId, commentID: row.server_id } },
        body: { comment: row.comment },
      }),
    );

    const newUpdated = (res as { updated?: string }).updated;

    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE task_comments SET synced_at = ?, dirty = 0, updated_at = ?
         WHERE local_id = ? AND updated_at = ?`,
        [new Date().toISOString(), newUpdated ?? new Date().toISOString(), localId, row.updated_at],
      );
    });
    notify('comments');
    return;
  }

  if (op.op === 'delete') {
    if (row.server_id !== 0) {
      await callApiIgnore404(
        client.DELETE('/tasks/{taskID}/comments/{commentID}', {
          params: { path: { taskID: taskServerId, commentID: row.server_id } },
        }),
      );
    }
    await withTx(async (tx) => {
      await tx.execute('DELETE FROM task_comments WHERE local_id = ?', [localId]);
    });
    notify('comments');
  }
}
