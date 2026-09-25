import { callApi, type ApiClient } from '@/api/client';
import { withTx, exec, type Database } from '@/db';
import { notify } from '@/db/bus';
import { ApiError } from '@/api/errors';
import { type OutboxRow, type ProjectLookup, callApiIgnore404, cachedCreateResponse, cacheCreateResponse } from './shared';

export interface ViewRow {
  local_id: string;
  server_id: number | null;
  project_local_id: string;
  title: string;
  view_kind: string;
  position: number | null;
  filter: string | null;
  bucket_configuration_mode: string;
  done_bucket_server_id: number | null;
  default_bucket_server_id: number | null;
  deleted: number;
}

export type ViewKindLiteral = 'list' | 'gantt' | 'table' | 'kanban';
export type BucketModeLiteral = 'none' | 'manual' | 'filter';

export function viewFilterForBody(raw: string | null): unknown {
  if (!raw) return undefined;
  // Stored as the server's TaskCollection JSON; a bare string is wrapped.
  if (raw.trimStart().startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return { filter: raw };
}

export function viewBody(row: ViewRow): Record<string, unknown> {
  const filter = viewFilterForBody(row.filter);
  return {
    title: row.title,
    view_kind: row.view_kind as ViewKindLiteral,
    ...(row.position != null ? { position: row.position } : {}),
    ...(filter !== undefined ? { filter } : {}),
    bucket_configuration_mode: row.bucket_configuration_mode as BucketModeLiteral,
    // Vikunja uses 0 for "no done/default bucket".
    done_bucket_id: row.done_bucket_server_id ?? 0,
    default_bucket_id: row.default_bucket_server_id ?? 0,
  };
}

export async function executeViewOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  const localId = op.entity_local_id;
  const [row] = await db.select<ViewRow[]>(
    `SELECT local_id, server_id, project_local_id, title, view_kind,
            position, filter, bucket_configuration_mode,
            done_bucket_server_id, default_bucket_server_id, deleted
       FROM project_views WHERE local_id = ? LIMIT 1`,
    [localId],
  );
  if (!row) return;

  const [proj] = await db.select<ProjectLookup[]>(
    `SELECT server_id FROM projects WHERE local_id = ? LIMIT 1`,
    [row.project_local_id],
  );
  const projectServerId = proj?.server_id ?? null;

  if (op.op === 'create') {
    if (row.deleted === 1) {
      await exec('DELETE FROM project_views WHERE local_id = ?', [localId]);
      notify('views');
      return;
    }
    if (row.server_id !== null) return;

    const cachedId = cachedCreateResponse(op.payload);
    if (typeof cachedId === 'number') {
      await withTx(async (tx) => {
        await tx.execute(
          `UPDATE project_views SET server_id = ?, synced_at = ?, dirty = 0 WHERE local_id = ?`,
          [cachedId, new Date().toISOString(), localId],
        );
        await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
      });
      notify('views');
      return;
    }

    if (!projectServerId) {
      throw new ApiError(408, null, 'view: parent project not synced yet', true, true);
    }
    const res = await callApi(
      client.PUT('/projects/{project}/views', {
        params: { path: { project: projectServerId } },
        body: viewBody(row),
      }),
    );
    const newServerId = (res as { id?: number }).id;

    await cacheCreateResponse(op.id, op.payload, newServerId);

    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE project_views SET server_id = ?, synced_at = ?, dirty = 0 WHERE local_id = ?`,
        [newServerId ?? null, new Date().toISOString(), localId],
      );
      await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
    });
    notify('views');
    return;
  }

  if (op.op === 'update') {
    if (row.deleted === 1) return;
    if (row.server_id === null || !projectServerId) {
      throw new ApiError(408, null, 'view: not synced yet', true, true);
    }
    await callApi(
      client.POST('/projects/{project}/views/{id}', {
        params: { path: { project: projectServerId, id: row.server_id } },
        body: viewBody(row),
      }),
    );
    await exec(
      `UPDATE project_views SET synced_at = ?, dirty = 0 WHERE local_id = ?`,
      [new Date().toISOString(), localId],
    );
    notify('views');
    return;
  }

  if (op.op === 'delete') {
    if (row.server_id !== null && projectServerId) {
      await callApiIgnore404(
        client.DELETE('/projects/{project}/views/{id}', {
          params: { path: { project: projectServerId, id: row.server_id } },
        }),
      );
    }
    await exec('DELETE FROM project_views WHERE local_id = ?', [localId]);
    notify('views');
  }
}
