import { nanoid } from 'nanoid';
import { getDb } from './index';
import { notify } from './bus';
import type { Project, ProjectResponse } from '@/domain/project';

interface ProjectRow {
  local_id: string;
  server_id: number | null;
  title: string;
  description: string | null;
  parent_local_id: string | null;
  hex_color: string | null;
  is_archived: number;
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
    hexColor: row.hex_color,
    isArchived: row.is_archived === 1,
    position: row.position,
    updatedAt: row.updated_at,
  };
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const rows = await db.select<ProjectRow[]>(
    `SELECT local_id, server_id, title, description, parent_local_id,
            hex_color, is_archived, position, updated_at
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
            hex_color, is_archived, position, updated_at
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
  const existing = await localIdForServerId(serverId);
  const localId = existing ?? nanoid();
  const now = new Date().toISOString();
  const updatedAt = payload.updated ?? now;
  const isArchived = payload.is_archived === true ? 1 : 0;
  const parentLocalId =
    typeof payload.parent_project_id === 'number' && payload.parent_project_id > 0
      ? await localIdForServerId(payload.parent_project_id)
      : null;

  const db = await getDb();
  if (existing) {
    await db.execute(
      `UPDATE projects SET
         title           = ?,
         description     = ?,
         parent_local_id = ?,
         hex_color       = ?,
         is_archived     = ?,
         position        = ?,
         updated_at      = ?,
         synced_at       = ?,
         last_synced     = ?,
         dirty           = 0,
         deleted         = 0
       WHERE local_id = ?`,
      [
        payload.title,
        payload.description ?? null,
        parentLocalId,
        payload.hex_color ?? null,
        isArchived,
        payload.position ?? null,
        updatedAt,
        now,
        JSON.stringify(payload),
        localId,
      ],
    );
  } else {
    await db.execute(
      `INSERT INTO projects (
         local_id, server_id, title, description, parent_local_id,
         hex_color, is_archived, position, updated_at, synced_at,
         last_synced, dirty, deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [
        localId,
        serverId,
        payload.title,
        payload.description ?? null,
        parentLocalId,
        payload.hex_color ?? null,
        isArchived,
        payload.position ?? null,
        updatedAt,
        now,
        JSON.stringify(payload),
      ],
    );
  }

  notify('projects');
  return localId;
}
