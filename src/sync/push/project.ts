import { callApi, type ApiClient } from '@/api/client';
import { updatePartial } from '@/api/partial';
import type { components as V2 } from '@/api/schema.v2';
import { getDb, withTx, type Database } from '@/db';
import { notify } from '@/db/bus';
import { ApiError } from '@/api/errors';
import { type OutboxRow, callApiIgnore404, cachedCreateResponse, cacheCreateResponse, checkDivergence } from './shared';

export interface ProjectRow {
  local_id: string;
  server_id: number | null;
  title: string;
  description: string | null;
  parent_local_id: string | null;
  hex_color: string | null;
  is_archived: number;
  position: number | null;
  updated_at: string;
  deleted: number;
}

export async function executeProjectOp(
  client: ApiClient,
  db: Database,
  op: OutboxRow,
): Promise<void> {
  const localId = op.entity_local_id;
  const [row] = await db.select<ProjectRow[]>(
    `SELECT local_id, server_id, title, description, parent_local_id,
            hex_color, is_archived, position, updated_at, deleted
       FROM projects WHERE local_id = ? LIMIT 1`,
    [localId],
  );
  if (!row) return;

  if (op.op === 'create') {
    if (row.deleted === 1) {
      await withTx(async (tx) => {
        await tx.execute('DELETE FROM projects WHERE local_id = ?', [localId]);
      });
      notify('projects');
      return;
    }
    if (row.server_id !== null) return;

    const cachedId = cachedCreateResponse(op.payload);
    if (typeof cachedId === 'number') {
      await withTx(async (tx) => {
        await tx.execute(
          `UPDATE projects SET server_id = ?, synced_at = ?, dirty = 0 WHERE local_id = ?`,
          [cachedId, new Date().toISOString(), localId],
        );
        await tx.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
      });
      notify('projects');
      return;
    }

    const res = await callApi(
      client.PUT('/projects', { body: await projectBodyWithParent(row) }),
    );
    const newServerId = (res as { id?: number }).id;
    const newUpdated = (res as { updated?: string }).updated;

    await cacheCreateResponse(op.id, op.payload, newServerId);

    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE projects SET server_id = ?, synced_at = ?, dirty = 0, updated_at = ?
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
    notify('projects');
    return;
  }

  if (op.op === 'update') {
    if (row.deleted === 1) return;
    if (row.server_id === null) {
      throw new ApiError(408, null, 'Cannot update a project without server id', true, true);
    }

    // Pre-push divergence check
    const [projLastSynced] = await db.select<{ last_synced: string | null }[]>(
      `SELECT last_synced FROM projects WHERE local_id = ? LIMIT 1`,
      [localId],
    );
    if (projLastSynced?.last_synced) {
      try {
        const serverPayload = await callApi(
          client.GET('/projects/{id}', { params: { path: { id: row.server_id } } }),
        ) as Record<string, unknown> | undefined;
        if (serverPayload) {
          const conflicted = await checkDivergence(
            projLastSynced.last_synced,
            serverPayload,
            ['title', 'description'],
            'project',
            localId,
          );
          if (conflicted) return;
        }
      } catch {
        // skip divergence check on fetch failure
      }
    }

    const body = await projectBodyWithParent(row);
    const res = await updatePartial(
      client,
      `/projects/${row.server_id}`,
      projectToMergePatch(body),
      () =>
        callApi(
          client.POST('/projects/{id}', {
            params: { path: { id: row.server_id! } },
            body,
          }),
        ),
    );
    const newUpdated = (res as { updated?: string } | null)?.updated;
    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE projects SET synced_at = ?, dirty = 0, updated_at = ?
         WHERE local_id = ? AND updated_at = ?`,
        [
          new Date().toISOString(),
          newUpdated ?? new Date().toISOString(),
          localId,
          row.updated_at,
        ],
      );
    });
    notify('projects');
    return;
  }

  if (op.op === 'delete') {
    if (row.server_id === null) {
      await withTx(async (tx) => {
        await tx.execute('DELETE FROM projects WHERE local_id = ?', [localId]);
      });
      notify('projects');
      return;
    }
    await callApiIgnore404(
      client.DELETE('/projects/{id}', {
        params: { path: { id: row.server_id } },
      }),
    );
    await withTx(async (tx) => {
      // Prune relations for the project's tasks BEFORE deleting them —
      // the subquery needs those task rows to still exist.
      await tx.execute(
        `DELETE FROM task_relations
          WHERE task_local_id IN (SELECT local_id FROM tasks WHERE project_local_id = ?)
             OR other_task_local_id IN (SELECT local_id FROM tasks WHERE project_local_id = ?)`,
        [localId, localId],
      );
      await tx.execute('DELETE FROM tasks WHERE project_local_id = ?', [localId]);
      await tx.execute('DELETE FROM projects WHERE local_id = ?', [localId]);
    });
    notify('projects');
    notify('tasks');
  }
}

export async function resolveParentServerId(
  parentLocalId: string | null,
): Promise<number | null> {
  if (!parentLocalId) return null;
  const db = await getDb();
  const [row] = await db.select<{ server_id: number | null }[]>(
    `SELECT server_id FROM projects WHERE local_id = ? LIMIT 1`,
    [parentLocalId],
  );
  return row?.server_id ?? null;
}

export function projectBody(row: ProjectRow): Record<string, unknown> {
  return {
    title: row.title,
    description: row.description ?? undefined,
    hex_color: row.hex_color ? row.hex_color.replace(/^#/, '') : undefined,
    is_archived: row.is_archived === 1,
    position: row.position ?? undefined,
    parent_project_id: undefined as number | undefined,
  };
}

/**
 * {@link projectBodyWithParent} as a v2 merge-patch: cleared fields are spelled
 * out (see taskToMergePatch), and fields Cria does not track (identifier, cover
 * image, ...) are left unnamed so the server keeps them.
 */
export function projectToMergePatch(body: Record<string, unknown>): Partial<V2['schemas']['ProjectReadBody']> {
  const patch: Record<string, unknown> & Partial<V2['schemas']['ProjectReadBody']> = {
    ...body,
    description: (body.description as string | undefined) ?? '',
    hex_color: (body.hex_color as string | undefined) ?? '',
    parent_project_id: (body.parent_project_id as number | undefined) ?? 0,
  };
  if (patch.position === undefined) delete patch.position;
  return patch;
}

export async function projectBodyWithParent(row: ProjectRow): Promise<Record<string, unknown>> {
  const body = projectBody(row);
  body.parent_project_id =
    (await resolveParentServerId(row.parent_local_id)) ?? undefined;
  return body;
}
