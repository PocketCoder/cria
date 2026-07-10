import { nanoid } from 'nanoid';
import { getDb, exec, withTx } from './index';
import { notify } from './bus';
import { mergeFromServer } from './syncMerge';
import type { ProjectView, ViewKind, BucketConfigMode, ViewResponse } from '@/domain/view';

export interface ViewInput {
  title: string;
  viewKind: ViewKind;
  position?: number;
  filter?: string | null;
  bucketConfigurationMode?: BucketConfigMode;
  bucketConfiguration?: string | null;
}

export type ViewUpdate = Partial<{
  title: string;
  position: number;
  filter: string | null;
  bucketConfigurationMode: BucketConfigMode;
  bucketConfiguration: string | null;
  /** Server id of the bucket tasks are marked done in (null = none). */
  doneBucketServerId: number | null;
  /** Server id of the bucket new/unbucketed tasks land in (null = leftmost). */
  defaultBucketServerId: number | null;
}>;

interface ViewRow {
  local_id: string;
  server_id: number | null;
  project_local_id: string;
  title: string;
  view_kind: string;
  position: number | null;
  filter: string | null;
  bucket_configuration_mode: string;
  bucket_configuration: string | null;
  default_bucket_server_id: number | null;
  done_bucket_server_id: number | null;
  updated_at: string;
}

function rowToView(row: ViewRow): ProjectView {
  return {
    localId: row.local_id,
    serverId: row.server_id,
    projectLocalId: row.project_local_id,
    title: row.title,
    viewKind: row.view_kind as ViewKind,
    position: row.position,
    filter: row.filter,
    bucketConfigurationMode: row.bucket_configuration_mode as BucketConfigMode,
    bucketConfiguration: row.bucket_configuration,
    defaultBucketServerId: row.default_bucket_server_id,
    doneBucketServerId: row.done_bucket_server_id,
    updatedAt: row.updated_at,
  };
}

export async function listViewsForProject(
  projectLocalId: string,
): Promise<ProjectView[]> {
  const db = await getDb();
  const rows = await db.select<ViewRow[]>(
    `SELECT local_id, server_id, project_local_id,
            title, view_kind, position, filter,
            bucket_configuration_mode, bucket_configuration,
            default_bucket_server_id, done_bucket_server_id,
            updated_at
       FROM project_views
      WHERE project_local_id = ?
        AND deleted = 0
   ORDER BY position IS NULL, position ASC, title COLLATE NOCASE ASC`,
    [projectLocalId],
  );
  return rows.map(rowToView);
}

export async function getViewByLocalId(
  localId: string,
): Promise<ProjectView | null> {
  const db = await getDb();
  const rows = await db.select<ViewRow[]>(
    `SELECT local_id, server_id, project_local_id,
            title, view_kind, position, filter,
            bucket_configuration_mode, bucket_configuration,
            default_bucket_server_id, done_bucket_server_id,
            updated_at
       FROM project_views
      WHERE local_id = ?
        AND deleted = 0
      LIMIT 1`,
    [localId],
  );
  return rows[0] ? rowToView(rows[0]) : null;
}

async function projectLocalIdForServerId(
  projectServerId: number,
): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ local_id: string }[]>(
    `SELECT local_id FROM projects WHERE server_id = ? LIMIT 1`,
    [projectServerId],
  );
  return rows[0]?.local_id ?? null;
}

/**
 * A brand-new project's views start as local-only placeholders (see
 * `createDefaultViews`) with `server_id = NULL`. Point the matching
 * placeholder at the incoming server view *before* the server_id
 * lookup in `mergeFromServer` runs, so it updates that row in place
 * instead of minting a new `local_id` and soft-deleting the
 * placeholder out from under anything (e.g. buckets) already created
 * against it.
 */
async function claimPlaceholderView(
  projectLocalId: string,
  viewKind: string,
  serverId: number,
): Promise<void> {
  await exec(
    `UPDATE project_views SET server_id = ?
       WHERE project_local_id = ? AND view_kind = ?
         AND server_id IS NULL AND dirty = 0 AND deleted = 0`,
    [serverId, projectLocalId, viewKind],
  );
}

/**
 * Upsert a view payload that came from the server.
 *
 * Lookup is by `server_id`. If a row already exists we update in place;
 * if not we mint a new `local_id` (nanoid). `dirty` is forced to 0
 * because the row is — by definition — synced.
 *
 * Returns the resolved `local_id` so callers can chain.
 */
export async function upsertViewFromServer(
  payload: ViewResponse,
  /** Parent already known to the caller (replaceViewsForProjectFromServer)
   * — skips re-resolving payload.project_id, which for saved-filter
   * pseudo-projects is NEGATIVE and used to be rejected outright. */
  knownProjectLocalId?: string,
): Promise<string> {
  const now = new Date().toISOString();
  const updatedAt = payload.updated ?? now;
  const projectLocalId =
    knownProjectLocalId ??
    (typeof payload.project_id === 'number' && payload.project_id !== 0
      ? await projectLocalIdForServerId(payload.project_id)
      : null);
  if (!projectLocalId) {
    throw new Error(
      `upsertViewFromServer: parent project ${payload.project_id} not found locally`,
    );
  }

  await claimPlaceholderView(projectLocalId, payload.view_kind, payload.id);

  const filterJson =
    payload.filter && typeof payload.filter === 'object'
      ? JSON.stringify(payload.filter)
      : null;
  const bucketConfigJson =
    payload.bucket_configuration &&
    Array.isArray(payload.bucket_configuration)
      ? JSON.stringify(payload.bucket_configuration)
      : null;

  return mergeFromServer({
    entity: 'view',
    serverId: payload.id,
    remotePayload: payload as unknown as Record<string, unknown>,
    insert: (localId, lastSyncedJson) => ({
      sql: `INSERT INTO project_views (
              local_id, server_id, project_local_id,
              title, view_kind, position, filter,
              bucket_configuration_mode, bucket_configuration,
              default_bucket_server_id, done_bucket_server_id,
              updated_at, synced_at, last_synced, dirty, deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      params: [
        localId,
        payload.id,
        projectLocalId,
        payload.title,
        payload.view_kind,
        payload.position ?? null,
        filterJson,
        payload.bucket_configuration_mode ?? 'none',
        bucketConfigJson,
        payload.default_bucket_id ?? null,
        payload.done_bucket_id ?? null,
        updatedAt,
        now,
        lastSyncedJson,
      ],
    }),
    update: (localId, lastSyncedJson) => ({
      sql: `UPDATE project_views SET
              title                     = ?,
              view_kind                 = ?,
              position                  = ?,
              filter                    = ?,
              bucket_configuration_mode = ?,
              bucket_configuration      = ?,
              default_bucket_server_id  = ?,
              done_bucket_server_id     = ?,
              updated_at                = ?,
              synced_at                 = ?,
              last_synced               = ?,
              dirty                     = 0,
              deleted                   = 0
            WHERE local_id = ? AND deleted = 0 AND dirty = 0`,
      params: [
        payload.title,
        payload.view_kind,
        payload.position ?? null,
        filterJson,
        payload.bucket_configuration_mode ?? 'none',
        bucketConfigJson,
        payload.default_bucket_id ?? null,
        payload.done_bucket_id ?? null,
        updatedAt,
        now,
        lastSyncedJson,
        localId,
      ],
    }),
  });
}

/**
 * Replace all views for a project from a server response.
 *
 * Reads the current views list, upserts each incoming payload, and
 * soft-deletes any local views that weren't in the server response.
 * Silent — no notify() — because this runs inside pull.
 */
export async function replaceViewsForProjectFromServer(
  projectLocalId: string,
  payloads: ViewResponse[],
): Promise<void> {
  const upserted = new Set<string>();

  for (const payload of payloads) {
    const localId = await upsertViewFromServer(payload, projectLocalId);
    upserted.add(localId);
  }

  // Soft-delete views the server didn't return (user deleted them
  // on another client or the default views have changed). Dirty rows are
  // spared: a locally-created view that hasn't pushed yet is authoritative
  // until the outbox drains, so a pull mustn't wipe it (it has no server_id
  // and would never be in `upserted`).
  if (upserted.size > 0) {
    const db = await getDb();
    const placeholders = [...upserted].map(() => '?').join(', ');
    await db.execute(
      `UPDATE project_views SET deleted = 1, updated_at = ?
        WHERE project_local_id = ?
          AND local_id NOT IN (${placeholders})
          AND deleted = 0
          AND dirty = 0`,
      [new Date().toISOString(), projectLocalId, ...upserted],
    );
  }
}

/**
 * The four views Vikunja creates for every project on the server. We
 * mirror the same set + order locally as a fallback so the view UI works
 * for projects whose server views haven't been pulled yet (offline, or a
 * brand-new local project that hasn't synced). The first/default view is
 * the List.
 */
const DEFAULT_VIEWS: ReadonlyArray<{
  title: string;
  viewKind: ViewKind;
  position: number;
  bucketConfigurationMode: BucketConfigMode;
}> = [
  { title: 'List', viewKind: 'list', position: 0, bucketConfigurationMode: 'none' },
  { title: 'Gantt', viewKind: 'gantt', position: 1, bucketConfigurationMode: 'none' },
  { title: 'Table', viewKind: 'table', position: 2, bucketConfigurationMode: 'none' },
  { title: 'Kanban', viewKind: 'kanban', position: 3, bucketConfigurationMode: 'manual' },
];

/**
 * Seed the four default views for a project that has none.
 *
 * These rows are **local-only**: `dirty = 0` and no outbox entry, so they
 * are never pushed to the server (Vikunja auto-creates its own defaults
 * when the project is created server-side). When the real server views
 * arrive, `replaceViewsForProjectFromServer` upserts them and soft-deletes
 * these placeholders — no duplicates, no spurious creates.
 *
 * Idempotent: a no-op if the project already has any (non-deleted) view.
 * Silent — no notify(); callers in the sync/query path read the fresh list
 * themselves.
 */
export async function createDefaultViews(
  projectLocalId: string,
): Promise<ProjectView[]> {
  const existing = await listViewsForProject(projectLocalId);
  if (existing.length > 0) return existing;

  const now = new Date().toISOString();
  await withTx(async (tx) => {
    for (const v of DEFAULT_VIEWS) {
      await tx.execute(
        `INSERT INTO project_views (
           local_id, server_id, project_local_id,
           title, view_kind, position, filter,
           bucket_configuration_mode, bucket_configuration,
           updated_at, dirty, deleted
         ) VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, NULL, ?, 0, 0)`,
        [
          nanoid(),
          projectLocalId,
          v.title,
          v.viewKind,
          v.position,
          v.bucketConfigurationMode,
          now,
        ],
      );
    }
  });

  return listViewsForProject(projectLocalId);
}

/* ───────────────────── user mutations ──────────────────── */

export async function createView(
  projectLocalId: string,
  input: ViewInput,
): Promise<ProjectView> {
  const localId = nanoid();
  const now = new Date().toISOString();
  const db = await getDb();
  const [maxRow] = await db.select<{ max_pos: number | null }[]>(
    `SELECT MAX(position) AS max_pos FROM project_views
      WHERE project_local_id = ? AND deleted = 0`,
    [projectLocalId],
  );
  const nextPosition = input.position ?? (maxRow?.max_pos ?? 0) + 1024;

  await withTx(async (tx) => {
    await tx.execute(
      `INSERT INTO project_views (
         local_id, server_id, project_local_id,
         title, view_kind, position, filter,
         bucket_configuration_mode, bucket_configuration,
         updated_at, dirty, deleted
       ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [
        localId,
        projectLocalId,
        input.title,
        input.viewKind,
        nextPosition,
        input.filter ?? null,
        input.bucketConfigurationMode ?? 'none',
        input.bucketConfiguration ?? null,
        now,
      ],
    );
    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('view', ?, 'create', ?, ?)`,
      [localId, JSON.stringify(input), now],
    );
  });

  notify('views');
  notify('outbox');

  const created = await getViewByLocalId(localId);
  if (!created) throw new Error(`Failed to retrieve newly created view ${localId}`);
  return created;
}

export async function updateView(
  localId: string,
  input: ViewUpdate,
): Promise<ProjectView> {
  const now = new Date().toISOString();
  const current = await getViewByLocalId(localId);
  if (!current) throw new Error(`View not found: ${localId}`);

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
  if (input.filter !== undefined) {
    sets.push('filter = ?');
    params.push(input.filter);
  }
  if (input.bucketConfigurationMode !== undefined) {
    sets.push('bucket_configuration_mode = ?');
    params.push(input.bucketConfigurationMode);
  }
  if (input.bucketConfiguration !== undefined) {
    sets.push('bucket_configuration = ?');
    params.push(input.bucketConfiguration);
  }
  if (input.doneBucketServerId !== undefined) {
    sets.push('done_bucket_server_id = ?');
    params.push(input.doneBucketServerId);
  }
  if (input.defaultBucketServerId !== undefined) {
    sets.push('default_bucket_server_id = ?');
    params.push(input.defaultBucketServerId);
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(now);
    sets.push('dirty = 1');
    params.push(localId);

    await withTx(async (tx) => {
      await tx.execute(
        `UPDATE project_views SET ${sets.join(', ')} WHERE local_id = ?`,
        params,
      );
      await tx.execute(
        `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
         VALUES ('view', ?, 'update', ?, ?)`,
        [localId, JSON.stringify(input), now],
      );
    });
  }

  notify('views');
  notify('outbox');

  const updated = await getViewByLocalId(localId);
  if (!updated) throw new Error(`Failed to retrieve updated view ${localId}`);
  return updated;
}

export async function deleteView(localId: string): Promise<void> {
  const now = new Date().toISOString();

  await withTx(async (tx) => {
    await tx.execute(
      `UPDATE project_views SET deleted = 1, dirty = 1, updated_at = ? WHERE local_id = ?`,
      [now, localId],
    );
    await tx.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('view', ?, 'delete', '{}', ?)`,
      [localId, now],
    );
  });

  notify('views');
  notify('outbox');
}
