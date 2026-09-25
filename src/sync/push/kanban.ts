import { callApi, type ApiClient } from '@/api/client';
import { withTx, exec, type Database } from '@/db';
import { notify } from '@/db/bus';
import { ApiError } from '@/api/errors';
import { type OutboxRow, callApiIgnore404, cachedCreateResponse, cacheCreateResponse } from './shared';

export interface BucketRow {
  local_id: string;
  server_id: number | null;
  view_local_id: string;
  title: string;
  position: number | null;
  task_limit: number;
  deleted: number;
}

export interface ViewContext {
  view_server_id: number | null;
  project_server_id: number | null;
}

/** Resolve the server ids of a view and its parent project from a view
 * local id. Either may be null if not yet synced. */
export async function resolveViewContext(
  db: Database,
  viewLocalId: string,
): Promise<ViewContext> {
  const [row] = await db.select<ViewContext[]>(
    `SELECT pv.server_id AS view_server_id, p.server_id AS project_server_id
       FROM project_views pv
       JOIN projects p ON p.local_id = pv.project_local_id
      WHERE pv.local_id = ? LIMIT 1`,
    [viewLocalId],
  );
  return {
    view_server_id: row?.view_server_id ?? null,
    project_server_id: row?.project_server_id ?? null,
  };
}

export function bucketBody(row: BucketRow): Record<string, unknown> {
  return {
    title: row.title,
    limit: row.task_limit ?? 0,
    ...(row.position != null ? { position: row.position } : {}),
  };
}

export async function executeBucketOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  const localId = op.entity_local_id;
  const [row] = await db.select<BucketRow[]>(
    `SELECT local_id, server_id, view_local_id, title, position, task_limit, deleted
       FROM buckets WHERE local_id = ? LIMIT 1`,
    [localId],
  );
  if (!row) return;

  const { view_server_id: viewServerId, project_server_id: projectServerId } =
    await resolveViewContext(db, row.view_local_id);

  if (op.op === 'create') {
    if (row.deleted === 1) {
      await dropBucketLocally(localId);
      return;
    }
    if (row.server_id !== null) return;

    const cachedId = cachedCreateResponse(op.payload);
    if (typeof cachedId === 'number') {
      await withTx(async (tx) => {
        await tx.execute(
          `UPDATE buckets SET server_id = ?, synced_at = ?, dirty = 0 WHERE local_id = ?`,
          [cachedId, new Date().toISOString(), localId],
        );
        await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
      });
      notify('views');
      return;
    }

    if (!projectServerId || !viewServerId) {
      throw new ApiError(408, null, 'bucket: parent view not synced yet', true, true);
    }
    const res = await callApi(
      client.PUT('/projects/{id}/views/{view}/buckets', {
        params: { path: { id: projectServerId, view: viewServerId } },
        body: bucketBody(row),
      }),
    );
    const newServerId = (res as { id?: number }).id;

    await cacheCreateResponse(op.id, op.payload, newServerId);

    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE buckets SET server_id = ?, synced_at = ?, dirty = 0 WHERE local_id = ?`,
        [newServerId ?? null, new Date().toISOString(), localId],
      );
      await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
    });
    notify('views');
    return;
  }

  if (op.op === 'update') {
    if (row.deleted === 1) return;
    if (row.server_id === null || !projectServerId || !viewServerId) {
      throw new ApiError(408, null, 'bucket: not synced yet', true, true);
    }
    await callApi(
      client.POST('/projects/{projectID}/views/{view}/buckets/{bucketID}', {
        params: {
          path: {
            projectID: projectServerId,
            view: viewServerId,
            bucketID: row.server_id,
          },
        },
        body: bucketBody(row),
      }),
    );
    await exec(
      `UPDATE buckets SET synced_at = ?, dirty = 0 WHERE local_id = ?`,
      [new Date().toISOString(), localId],
    );
    notify('views');
    return;
  }

  if (op.op === 'delete') {
    if (row.server_id === null) {
      await dropBucketLocally(localId);
      return;
    }
    if (!projectServerId || !viewServerId) {
      throw new ApiError(408, null, 'bucket: parent view not synced yet', true, true);
    }
    await callApiIgnore404(
      client.DELETE('/projects/{projectID}/views/{view}/buckets/{bucketID}', {
        params: {
          path: {
            projectID: projectServerId,
            view: viewServerId,
            bucketID: row.server_id,
          },
        },
      }),
    );
    await dropBucketLocally(localId);
  }
}

export async function dropBucketLocally(localId: string): Promise<void> {
  await withTx(async (tx) => {
    await tx.execute('DELETE FROM task_buckets WHERE bucket_local_id = ?', [localId]);
    await tx.execute('DELETE FROM buckets WHERE local_id = ?', [localId]);
  });
  notify('views');
}

/* ──────────────────────── task-bucket ops ─────────────────── */

export async function executeTaskBucketOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  // Payload: { view_local_id, bucket_local_id }; entity is the task.
  const payload = JSON.parse(op.payload) as {
    view_local_id: string;
    bucket_local_id: string;
  };
  const taskLocalId = op.entity_local_id;

  const [taskRow] = await db.select<{ server_id: number | null }[]>(
    `SELECT server_id FROM tasks WHERE local_id = ? LIMIT 1`,
    [taskLocalId],
  );
  const [bucketRow] = await db.select<{ server_id: number | null }[]>(
    `SELECT server_id FROM buckets WHERE local_id = ? LIMIT 1`,
    [payload.bucket_local_id],
  );
  const { view_server_id: viewServerId, project_server_id: projectServerId } =
    await resolveViewContext(db, payload.view_local_id);

  const taskServerId = taskRow?.server_id ?? null;
  const bucketServerId = bucketRow?.server_id ?? null;

  if (!taskServerId || !bucketServerId || !viewServerId || !projectServerId) {
    // The task or its target bucket hasn't synced yet — retry after their
    // create ops land (FIFO keeps those ahead of this assignment).
    throw new ApiError(408, null, 'task_bucket: task/bucket not synced yet', true, true);
  }

  await callApi(
    client.POST('/projects/{project}/views/{view}/buckets/{bucket}/tasks', {
      params: {
        path: {
          project: projectServerId,
          view: viewServerId,
          bucket: bucketServerId,
        },
      },
      body: {
        task_id: taskServerId,
        bucket_id: bucketServerId,
        project_view_id: viewServerId,
      },
    }),
  );
  // Nothing to reconcile locally — the assignment row is already written.
}

/* ──────────────────────── task-position ops ─────────────────── */

export async function executeTaskPositionOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  const payload = JSON.parse(op.payload) as {
    view_local_id: string;
    position: number;
  };
  const taskLocalId = op.entity_local_id;

  const [taskRow] = await db.select<{ server_id: number | null }[]>(
    `SELECT server_id FROM tasks WHERE local_id = ? LIMIT 1`,
    [taskLocalId],
  );
  const { view_server_id: viewServerId } = await resolveViewContext(
    db,
    payload.view_local_id,
  );

  const taskServerId = taskRow?.server_id ?? null;

  if (!taskServerId || !viewServerId) {
    throw new ApiError(
      408,
      null,
      'task_position: task/view not synced yet',
      true,
      true,
    );
  }

  await callApi(
    client.POST('/tasks/{id}/position', {
      params: {
        path: { id: taskServerId },
      },
      body: {
        position: payload.position,
        project_view_id: viewServerId,
        task_id: taskServerId,
      },
    }),
  );
}
