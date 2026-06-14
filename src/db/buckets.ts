import { nanoid } from 'nanoid';
import { getDb, withTx } from './index';
import { mergeFromServer } from './syncMerge';
import { notify } from './bus';
import type { Bucket, TaskBucket, BucketResponse } from '@/domain/bucket';

interface BucketRow {
  local_id: string;
  server_id: number | null;
  view_local_id: string;
  title: string;
  position: number | null;
  task_limit: number;
  created_by_server_id: number | null;
  updated_at: string;
}

function rowToBucket(row: BucketRow): Bucket {
  return {
    localId: row.local_id,
    serverId: row.server_id,
    viewLocalId: row.view_local_id,
    title: row.title,
    position: row.position,
    limit: row.task_limit,
    createdByServerId: row.created_by_server_id,
    updatedAt: row.updated_at,
  };
}

const SELECT_BUCKET_COLS = `local_id, server_id, view_local_id, title, position, task_limit, created_by_server_id, updated_at`;

export async function listBucketsForView(viewLocalId: string): Promise<Bucket[]> {
  const db = await getDb();
  const rows = await db.select<BucketRow[]>(
    `SELECT ${SELECT_BUCKET_COLS}
       FROM buckets
      WHERE view_local_id = ?
        AND deleted = 0
   ORDER BY position IS NULL, position ASC`,
    [viewLocalId],
  );
  return rows.map(rowToBucket);
}

export async function getBucketByLocalId(localId: string): Promise<Bucket | null> {
  const db = await getDb();
  const rows = await db.select<BucketRow[]>(
    `SELECT ${SELECT_BUCKET_COLS}
       FROM buckets
      WHERE local_id = ?
        AND deleted = 0
      LIMIT 1`,
    [localId],
  );
  return rows[0] ? rowToBucket(rows[0]) : null;
}

async function viewLocalIdForServerId(
  viewServerId: number,
): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ local_id: string }[]>(
    `SELECT local_id FROM project_views WHERE server_id = ? LIMIT 1`,
    [viewServerId],
  );
  return rows[0]?.local_id ?? null;
}

/**
 * Upsert a bucket payload from the server (keyed by server_id). Sync-path
 * upsert — does not call `notify()`.
 */
export async function upsertBucketFromServer(
  payload: BucketResponse,
): Promise<string> {
  const now = new Date().toISOString();
  const updatedAt = payload.updated ?? now;
  const viewLocalId =
    typeof payload.project_view_id === 'number'
      ? await viewLocalIdForServerId(payload.project_view_id)
      : null;
  if (!viewLocalId) {
    throw new Error(
      `upsertBucketFromServer: parent view ${payload.project_view_id} not found locally`,
    );
  }

  return mergeFromServer({
    entity: 'bucket',
    serverId: payload.id,
    remotePayload: payload as unknown as Record<string, unknown>,
    insert: (localId, lastSyncedJson) => ({
      sql: `INSERT INTO buckets (
              local_id, server_id, view_local_id, title, position, task_limit,
              created_by_server_id, updated_at, synced_at, last_synced, dirty, deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      params: [
        localId,
        payload.id,
        viewLocalId,
        payload.title,
        payload.position ?? null,
        payload.limit ?? 0,
        payload.created_by_id ?? null,
        updatedAt,
        now,
        lastSyncedJson,
      ],
    }),
    update: (localId, lastSyncedJson) => ({
      sql: `UPDATE buckets SET
              title                 = ?,
              position              = ?,
              task_limit            = ?,
              updated_at            = ?,
              synced_at             = ?,
              last_synced           = ?,
              dirty                 = 0,
              deleted               = 0
            WHERE local_id = ? AND deleted = 0 AND dirty = 0`,
      params: [
        payload.title,
        payload.position ?? null,
        payload.limit ?? 0,
        updatedAt,
        now,
        lastSyncedJson,
        localId,
      ],
    }),
  });
}

/**
 * Replace all buckets for a view from a server response.
 * Upserts incoming buckets and soft-deletes locals not in the response.
 * Silent — no notify().
 */
export async function replaceBucketsForViewFromServer(
  viewLocalId: string,
  payloads: BucketResponse[],
): Promise<void> {
  const upserted = new Set<string>();

  for (const payload of payloads) {
    const localId = await upsertBucketFromServer(payload);
    upserted.add(localId);
  }

  // Spare dirty rows: a locally-created bucket that hasn't pushed yet has
  // no server_id, so it'd never be in `upserted` — without this guard a
  // pull racing ahead of the outbox push would wipe a brand-new bucket
  // (the "new buckets disappear on poll" bug).
  if (upserted.size > 0) {
    const db = await getDb();
    const placeholders = [...upserted].map(() => '?').join(', ');
    await db.execute(
      `UPDATE buckets SET deleted = 1, updated_at = ?
        WHERE view_local_id = ?
          AND local_id NOT IN (${placeholders})
          AND deleted = 0
          AND dirty = 0`,
      [new Date().toISOString(), viewLocalId, ...upserted],
    );
  }
}

/* ─── Task-bucket assignments ─── */

export async function listBucketAssignmentsForView(
  viewLocalId: string,
): Promise<TaskBucket[]> {
  const db = await getDb();
  const rows = await db.select<
    { task_local_id: string; view_local_id: string; bucket_local_id: string; position: number | null }[]
  >(
    `SELECT task_local_id, view_local_id, bucket_local_id, position
       FROM task_buckets
      WHERE view_local_id = ?
   ORDER BY position IS NULL, position ASC`,
    [viewLocalId],
  );
  return rows.map((r) => ({
    taskLocalId: r.task_local_id,
    viewLocalId: r.view_local_id,
    bucketLocalId: r.bucket_local_id,
    position: r.position,
  }));
}

/**
 * Get all task local_ids assigned to a specific bucket.
 */
export async function listTaskIdsForBucket(
  bucketLocalId: string,
): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ task_local_id: string }[]>(
    `SELECT task_local_id
       FROM task_buckets
      WHERE bucket_local_id = ?`,
    [bucketLocalId],
  );
  return rows.map((r) => r.task_local_id);
}

/**
 * Set a task's bucket assignment for a given kanban view.
 * Replaces any existing assignment for the (task, view) pair.
 * User mutation — calls notify('tasks') so the UI refreshes.
 */
export async function setTaskBucket(
  taskLocalId: string,
  viewLocalId: string,
  bucketLocalId: string,
  position?: number,
): Promise<void> {
  const now = new Date().toISOString();
  await withTx(async (tx) => {
    await tx.execute(
      `INSERT OR REPLACE INTO task_buckets (task_local_id, view_local_id, bucket_local_id, position)
       VALUES (?, ?, ?, ?)`,
      [taskLocalId, viewLocalId, bucketLocalId, position ?? 0],
    );
    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task_bucket', ?, 'update', ?, ?)`,
      [taskLocalId, JSON.stringify({ view_local_id: viewLocalId, bucket_local_id: bucketLocalId }), now],
    );
  });
  notify('tasks');
  notify('outbox');
}

/**
 * Update a task's position within its current bucket, creating a task_position
 * outbox entry that will be pushed to POST /tasks/{id}/position.
 * User mutation — calls notify('tasks') so the UI refreshes.
 */
export async function updateTaskPosition(
  taskLocalId: string,
  viewLocalId: string,
  position: number,
): Promise<void> {
  const now = new Date().toISOString();
  await withTx(async (tx) => {
    await tx.execute(
      `UPDATE task_buckets SET position = ? WHERE task_local_id = ? AND view_local_id = ?`,
      [position, taskLocalId, viewLocalId],
    );
    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task_position', ?, 'update', ?, ?)`,
      [taskLocalId, JSON.stringify({ view_local_id: viewLocalId, position }), now],
    );
  });
  notify('tasks');
  notify('outbox');
}

/**
 * Reorder all tasks in a bucket, assigning evenly-spaced positions.
 * Creates task_position outbox entries for each task.
 * User mutation — calls notify('tasks') so the UI refreshes.
 */
export async function reorderTasksInBucket(
  viewLocalId: string,
  orderedTaskIds: string[],
  baseStep = 1024,
): Promise<void> {
  const now = new Date().toISOString();
  await withTx(async (tx) => {
    for (let i = 0; i < orderedTaskIds.length; i++) {
      const position = (i + 1) * baseStep;
      await tx.execute(
        `UPDATE task_buckets SET position = ? WHERE task_local_id = ? AND view_local_id = ?`,
        [position, orderedTaskIds[i], viewLocalId],
      );
      await tx.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
         VALUES ('task_position', ?, 'update', ?, ?)`,
        [orderedTaskIds[i], JSON.stringify({ view_local_id: viewLocalId, position }), now],
      );
    }
  });
  notify('tasks');
  notify('outbox');
}

/**
 * Bulk-set bucket assignments from a server response (e.g. from the
 * kanban task-collection endpoint that embeds tasks in buckets).
 * Silent — no notify() — runs inside pull.
 */
export async function replaceBucketAssignmentsFromServer(
  viewLocalId: string,
  assignments: Array<{ taskServerId: number; bucketServerId: number }>,
): Promise<void> {
  const db = await getDb();

  // Resolve task_local_id and bucket_local_id for each assignment server_id
  for (const a of assignments) {
    const taskRows = await db.select<{ local_id: string }[]>(
      `SELECT local_id FROM tasks WHERE server_id = ? LIMIT 1`,
      [a.taskServerId],
    );
    const bucketRows = await db.select<{ local_id: string }[]>(
      `SELECT local_id FROM buckets WHERE server_id = ? LIMIT 1`,
      [a.bucketServerId],
    );
    if (taskRows[0] && bucketRows[0]) {
      await db.execute(
        `INSERT OR REPLACE INTO task_buckets (task_local_id, view_local_id, bucket_local_id)
         VALUES (?, ?, ?)`,
        [taskRows[0].local_id, viewLocalId, bucketRows[0].local_id],
      );
    }
  }
}

/* ─── User mutations (CRUD) ─── */

export interface BucketInput {
  title: string;
  viewLocalId: string;
  position?: number;
  limit?: number;
}

export type BucketUpdate = Partial<{
  title: string;
  position: number;
  limit: number;
}>;

export async function createBucket(input: BucketInput): Promise<Bucket> {
  const localId = nanoid();
  const now = new Date().toISOString();
  const db = await getDb();
  const [maxRow] = await db.select<{ max_pos: number | null }[]>(
    `SELECT MAX(position) AS max_pos FROM buckets
      WHERE view_local_id = ? AND deleted = 0`,
    [input.viewLocalId],
  );
  const nextPosition = input.position ?? (maxRow?.max_pos ?? 0) + 1024;

  await withTx(async (tx) => {
    await tx.execute(
      `INSERT INTO buckets (
         local_id, server_id, view_local_id, title, position, task_limit,
         updated_at, dirty, deleted
       ) VALUES (?, NULL, ?, ?, ?, ?, ?, 1, 0)`,
      [localId, input.viewLocalId, input.title, nextPosition, input.limit ?? 0, now],
    );
    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('bucket', ?, 'create', ?, ?)`,
      [localId, JSON.stringify(input), now],
    );
  });

  notify('views');
  notify('outbox');

  const created = await getBucketByLocalId(localId);
  if (!created) throw new Error(`Failed to retrieve newly created bucket ${localId}`);
  return created;
}

export async function updateBucket(
  localId: string,
  input: BucketUpdate,
): Promise<Bucket> {
  const now = new Date().toISOString();
  const current = await getBucketByLocalId(localId);
  if (!current) throw new Error(`Bucket not found: ${localId}`);

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    sets.push('title = ?');
    params.push(input.title);
  }
  if (input.position !== undefined) {
    sets.push('position = ?');
    params.push(input.position);
  }
  if (input.limit !== undefined) {
    sets.push('task_limit = ?');
    params.push(input.limit);
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(now);
    sets.push('dirty = 1');
    params.push(localId);

    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE buckets SET ${sets.join(', ')} WHERE local_id = ?`,
        params,
      );
      await tx.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
         VALUES ('bucket', ?, 'update', ?, ?)`,
        [localId, JSON.stringify(input), now],
      );
    });
  }

  notify('views');
  notify('outbox');

  const updated = await getBucketByLocalId(localId);
  if (!updated) throw new Error(`Failed to retrieve updated bucket ${localId}`);
  return updated;
}

export async function deleteBucket(localId: string): Promise<void> {
  const now = new Date().toISOString();

  await withTx(async (tx) => {
    await tx.execute(
      `UPDATE buckets SET deleted = 1, dirty = 1, updated_at = ? WHERE local_id = ?`,
      [now, localId],
    );
    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('bucket', ?, 'delete', '{}', ?)`,
      [localId, now],
    );
  });

  notify('views');
  notify('outbox');
}
