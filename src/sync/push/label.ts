import { callApi, type ApiClient } from '@/api/client';
import { withTx, type Database } from '@/db';
import { notify } from '@/db/bus';
import { ApiError } from '@/api/errors';
import { type OutboxRow, callApiIgnore404, cachedCreateResponse, cacheCreateResponse, checkDivergence } from './shared';

export interface LabelRow {
  local_id: string;
  server_id: number | null;
  title: string;
  description: string | null;
  hex_color: string | null;
  updated_at: string;
  deleted: number;
}

export async function executeLabelOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  const localId = op.entity_local_id;
  const [row] = await db.select<LabelRow[]>(
    `SELECT local_id, server_id, title, description, hex_color, updated_at, deleted
       FROM labels WHERE local_id = ? LIMIT 1`,
    [localId],
  );
  if (!row) return;

  if (op.op === 'create') {
    if (row.deleted === 1) {
      await withTx(async (tx) => {
        await tx.execute('DELETE FROM labels WHERE local_id = ?', [localId]);
      });
      notify('labels');
      return;
    }
    if (row.server_id !== null) return;

    const cachedId = cachedCreateResponse(op.payload);
    if (typeof cachedId === 'number') {
      await withTx(async (tx) => {
        await tx.execute(
          `UPDATE labels SET server_id = ?, synced_at = ?, dirty = 0 WHERE local_id = ?`,
          [cachedId, new Date().toISOString(), localId],
        );
        await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
      });
      notify('labels');
      return;
    }

    const res = await callApi(
      client.PUT('/labels', { body: labelBody(row) }),
    );
    const newServerId = (res as { id?: number }).id;
    const newUpdated = (res as { updated?: string }).updated;

    await cacheCreateResponse(op.id, op.payload, newServerId);

    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE labels SET server_id = ?, synced_at = ?, dirty = 0, updated_at = ?
         WHERE local_id = ? AND updated_at = ?`,
        [
          newServerId ?? null,
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
          row.updated_at,
        ],
      );
      await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
    });
    notify('labels');
    return;
  }

  if (op.op === 'update') {
    if (row.deleted === 1) return;
    if (row.server_id === null) {
      throw new ApiError(408, null, 'Cannot update a label without server id', true, true);
    }

    // Pre-push divergence check
    const [labelLastSynced] = await db.select<{ last_synced: string | null }[]>(
      `SELECT last_synced FROM labels WHERE local_id = ? LIMIT 1`,
      [localId],
    );
    if (labelLastSynced?.last_synced) {
      try {
        const serverPayload = await callApi(
          client.GET('/labels/{id}', { params: { path: { id: row.server_id } } }),
        ) as Record<string, unknown> | undefined;
        if (serverPayload) {
          const conflicted = await checkDivergence(
            labelLastSynced.last_synced,
            serverPayload,
            ['title', 'description'],
            'label',
            localId,
          );
          if (conflicted) return;
        }
      } catch {
        // skip divergence check on fetch failure
      }
    }

    const res = await callApi(
      client.PUT('/labels/{id}', {
        params: { path: { id: row.server_id } },
        body: labelBody(row),
      }),
    );
    const newUpdated = (res as { updated?: string }).updated;
    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE labels SET synced_at = ?, dirty = 0, updated_at = ?
         WHERE local_id = ? AND updated_at = ?`,
        [
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
          row.updated_at,
        ],
      );
    });
    notify('labels');
    return;
  }

  if (op.op === 'delete') {
    if (row.server_id === null) {
      await withTx(async (tx) => {
        await tx.execute('DELETE FROM labels WHERE local_id = ?', [localId]);
      });
      notify('labels');
      return;
    }
    await callApiIgnore404(
      client.DELETE('/labels/{id}', {
        params: { path: { id: row.server_id } },
      }),
    );
    await withTx(async (tx) => {
      await tx.execute('DELETE FROM task_labels WHERE label_local_id = ?', [localId]);
      await tx.execute('DELETE FROM labels WHERE local_id = ?', [localId]);
    });
    notify('labels');
    notify('task_labels');
  }
}

export function labelBody(row: LabelRow): Record<string, unknown> {
  return {
    title: row.title,
    description: row.description ?? undefined,
    hex_color: row.hex_color ? row.hex_color.replace(/^#/, '') : undefined,
  };
}
