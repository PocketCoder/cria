import { nanoid } from 'nanoid';
import { getDb, withTx } from './index';
import { notify } from './bus';
import { mergeFromServer } from './syncMerge';
import type { Project, ProjectResponse } from '@/domain/project';

export interface ProjectInput {
  title: string;
  description?: string | null;
  hexColor?: string | null;
  parentLocalId?: string | null;
}

export type ProjectUpdate = Partial<{
  title: string;
  description: string | null;
  hexColor: string | null;
  parentLocalId: string | null;
  isArchived: boolean;
  isFavorite: boolean;
}>;

interface ProjectRow {
  local_id: string;
  server_id: number | null;
  title: string;
  description: string | null;
  parent_local_id: string | null;
  hex_color: string | null;
  is_archived: number;
  is_favorite: number;
  position: number | null;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    localId: row.local_id,
    serverId: row.server_id,
    title: row.title,
    description: row.description,
    parentLocalId: row.parent_local_id,
    hexColor: row.hex_color ? (row.hex_color.startsWith('#') ? row.hex_color : `#${row.hex_color}`) : null,
    isArchived: row.is_archived === 1,
    isFavorite: row.is_favorite === 1,
    position: row.position,
    updatedAt: row.updated_at,
  };
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const rows = await db.select<ProjectRow[]>(
    `SELECT local_id, server_id, title, description, parent_local_id,
            hex_color, is_archived, is_favorite, position, updated_at
       FROM projects
      WHERE deleted = 0
   ORDER BY position IS NULL, position ASC, title COLLATE NOCASE ASC`,
  );
  return rows.map(rowToProject);
}

export async function getProjectByLocalId(
  localId: string,
): Promise<Project | null> {
  const db = await getDb();
  const rows = await db.select<ProjectRow[]>(
    `SELECT local_id, server_id, title, description, parent_local_id,
            hex_color, is_archived, is_favorite, position, updated_at
       FROM projects
      WHERE local_id = ?
        AND deleted = 0
      LIMIT 1`,
    [localId],
  );
  const row = rows[0];
  return row ? rowToProject(row) : null;
}

interface LocalIdByServer {
  local_id: string;
  server_id: number | null;
}

async function localIdForServerId(
  serverId: number,
): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<LocalIdByServer[]>(
    `SELECT local_id, server_id FROM projects WHERE server_id = ? LIMIT 1`,
    [serverId],
  );
  return rows[0]?.local_id ?? null;
}

/**
 * Upsert a project payload that came from the server.
 *
 * Lookup is by `server_id`. If a row already exists we update in place; if
 * not we mint a new `local_id` (nanoid). `dirty` is forced to 0 because the
 * row is — by definition — synced. `synced_at` and `updated_at` are stamped
 * to the server's `updated` (when present) or to "now" as a fallback.
 *
 * Parent resolution: if the payload references `parent_project_id`, we look
 * up the corresponding `local_id`. If the parent hasn't been synced yet we
 * leave the link null — pullProjects() is responsible for ordering parents
 * before children when paginating, but if the server returns them out of
 * order the next pull pass will fix the link.
 *
 * Returns the resolved `local_id` so callers can chain.
 */
export async function upsertProjectFromServer(
  payload: ProjectResponse,
): Promise<string> {
  const serverId = payload.id;
  const now = new Date().toISOString();
  const updatedAt = payload.updated ?? now;
  const isArchived = payload.is_archived === true ? 1 : 0;
  // Per-entity resolution: parent_project_id → parent_local_id. Stays
  // outside mergeFromServer because every entity resolves a different
  // set of FKs (tasks resolve project_id, labels resolve nothing).
  const parentLocalId =
    typeof payload.parent_project_id === 'number' && payload.parent_project_id > 0
      ? await localIdForServerId(payload.parent_project_id)
      : null;

  // Delegate dirty-guard + conflict detection to the shared helper.
  // Caller is only responsible for column mapping.
  return mergeFromServer({
    entity: 'project',
    serverId,
    remotePayload: payload as unknown as Record<string, unknown>,
    insert: (localId, lastSyncedJson) => ({
      sql: `INSERT INTO projects (
              local_id, server_id, title, description, parent_local_id,
              hex_color, is_archived, is_favorite, position, updated_at,
              synced_at, last_synced, dirty, deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      params: [
        localId,
        serverId,
        payload.title,
        payload.description ?? null,
        parentLocalId,
        payload.hex_color ?? null,
        isArchived,
        payload.is_favorite === true ? 1 : 0,
        payload.position ?? null,
        updatedAt,
        now,
        lastSyncedJson,
      ],
    }),
    update: (localId, lastSyncedJson) => ({
      sql: `UPDATE projects SET
              title           = ?,
              description     = ?,
              parent_local_id = ?,
              hex_color       = ?,
              is_archived     = ?,
              is_favorite     = ?,
              position        = ?,
              updated_at      = ?,
              synced_at       = ?,
              last_synced     = ?,
              dirty           = 0,
              deleted         = 0
            WHERE local_id = ? AND deleted = 0 AND dirty = 0`,
      params: [
        payload.title,
        payload.description ?? null,
        parentLocalId,
        payload.hex_color ?? null,
        isArchived,
        payload.is_favorite === true ? 1 : 0,
        payload.position ?? null,
        updatedAt,
        now,
        lastSyncedJson,
        localId,
      ],
    }),
  });
  // Intentionally no notify() here: sync-path upserts are driven from a
  // queryFn that re-reads after the pull completes. If we notified, the
  // bus subscription on useProjects would invalidate the query whose pull
  // is currently in flight and trigger an infinite refetch loop. The
  // user-mutation paths below live in separate functions and *do*
  // notify.
}

/* ───────────────────────────── user mutations ─────────────────────────── */
//
// Same pattern as createTask/updateTask/deleteTask in src/db/tasks.ts:
//   - Mint a local_id immediately (so foreign keys to other rows are
//     stable across the sync round-trip).
//   - Mark dirty=1; queue an outbox row; notify('projects') + 'outbox'.
//   - The push loop drains the outbox against /projects (PUT/POST/DELETE
//     per the Vikunja verb table).
//
// SELECT-then-write outside withTx is fine — serial() ensures no other
// writer interleaves between the read and the batched writes.

export async function createProject(input: ProjectInput): Promise<Project> {
  const localId = nanoid();
  const now = new Date().toISOString();

  await withTx(async (db) => {
    await db.execute(
      `INSERT INTO projects (
         local_id, server_id, title, description, parent_local_id,
         hex_color, is_archived, is_favorite, position, updated_at, dirty, deleted
       ) VALUES (?, NULL, ?, ?, ?, ?, 0, 0, NULL, ?, 1, 0)`,
      [
        localId,
        input.title,
        input.description ?? null,
        input.parentLocalId ?? null,
        input.hexColor ?? null,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('project', ?, 'create', ?, ?)`,
      [localId, JSON.stringify(input), now],
    );
  });

  notify('projects');
  notify('outbox');

  const created = await getProjectByLocalId(localId);
  if (!created) {
    throw new Error(`Failed to retrieve newly created project ${localId}`);
  }
  return created;
}

export async function updateProject(
  localId: string,
  input: ProjectUpdate,
): Promise<Project> {
  const now = new Date().toISOString();
  const current = await getProjectByLocalId(localId);
  if (!current) throw new Error(`Project not found: ${localId}`);

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    sets.push('title = ?');
    params.push(input.title);
  }
  if (input.description !== undefined) {
    sets.push('description = ?');
    params.push(input.description);
  }
  if (input.hexColor !== undefined) {
    sets.push('hex_color = ?');
    params.push(input.hexColor);
  }
  if (input.parentLocalId !== undefined) {
    sets.push('parent_local_id = ?');
    params.push(input.parentLocalId);
  }
  if (input.isArchived !== undefined) {
    sets.push('is_archived = ?');
    params.push(input.isArchived ? 1 : 0);
  }
  if (input.isFavorite !== undefined) {
    sets.push('is_favorite = ?');
    params.push(input.isFavorite ? 1 : 0);
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(now);
    sets.push('dirty = 1');
    params.push(localId);

    await withTx(async (db) => {
      await db.execute(
        `UPDATE projects SET ${sets.join(', ')} WHERE local_id = ?`,
        params,
      );
      await db.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
         VALUES ('project', ?, 'update', ?, ?)`,
        [localId, JSON.stringify(input), now],
      );
    });
  }

  notify('projects');
  notify('outbox');

  const updated = await getProjectByLocalId(localId);
  if (!updated) throw new Error(`Failed to retrieve updated project ${localId}`);
  return updated;
}

export async function deleteProject(localId: string): Promise<void> {
  const now = new Date().toISOString();

  await withTx(async (db) => {
    const rows = await db.select<{ local_id: string }[]>(
      `SELECT local_id FROM projects WHERE local_id = ? AND deleted = 0 LIMIT 1`,
      [localId],
    );
    if (rows.length === 0) return;

    // Soft-delete the project and every task that belongs to it. Server
    // will cascade on its side; the local cascade keeps the UI honest
    // immediately. Tasks need a soft delete + outbox 'delete' op only if
    // they have a server_id; otherwise just drop them (they were never
    // pushed). We keep this simple: soft-delete all locally with no
    // task-level outbox row. The project's DELETE on the server takes
    // the whole subtree with it.
    await db.execute(
      `UPDATE projects SET deleted = 1, dirty = 1, updated_at = ? WHERE local_id = ?`,
      [now, localId],
    );
    await db.execute(
      `UPDATE tasks SET deleted = 1, updated_at = ? WHERE project_local_id = ? AND deleted = 0`,
      [now, localId],
    );
    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('project', ?, 'delete', '{}', ?)`,
      [localId, now],
    );
  });

  notify('projects');
  notify('tasks');
  notify('outbox');
}
