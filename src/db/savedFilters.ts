import { getDb } from './index';
import { notify } from './bus';

export interface SavedFilter {
  serverId: number;
  title: string;
  description: string | null;
  filterQuery: string;
  filterIncludeNulls: boolean;
  updatedAt: string | null;
}

/** Shape of the relevant fields from GET /filters/{id}. */
export interface SavedFilterPayload {
  id?: number;
  title?: string;
  description?: string | null;
  filters?: {
    filter?: string;
    filter_include_nulls?: boolean;
  };
  updated?: string;
}

interface SavedFilterRow {
  server_id: number;
  title: string;
  description: string | null;
  filter_query: string;
  filter_include_nulls: number;
  updated_at: string | null;
}

function rowToFilter(row: SavedFilterRow): SavedFilter {
  return {
    serverId: row.server_id,
    title: row.title,
    description: row.description,
    filterQuery: row.filter_query,
    filterIncludeNulls: row.filter_include_nulls === 1,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS =
  'server_id, title, description, filter_query, filter_include_nulls, updated_at';

export async function listSavedFilters(): Promise<SavedFilter[]> {
  const db = await getDb();
  const rows = await db.select<SavedFilterRow[]>(
    `SELECT ${SELECT_COLS} FROM saved_filters
   ORDER BY title COLLATE NOCASE ASC`,
  );
  return rows.map(rowToFilter);
}

export async function getSavedFilterByServerId(
  serverId: number,
): Promise<SavedFilter | null> {
  const db = await getDb();
  const rows = await db.select<SavedFilterRow[]>(
    `SELECT ${SELECT_COLS} FROM saved_filters WHERE server_id = ?`,
    [serverId],
  );
  return rows.length ? rowToFilter(rows[0]) : null;
}

export async function upsertSavedFilterFromServer(
  payload: SavedFilterPayload,
): Promise<void> {
  if (typeof payload.id !== 'number') return;
  const db = await getDb();
  await db.execute(
    `INSERT INTO saved_filters
       (server_id, title, description, filter_query, filter_include_nulls, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       filter_query = excluded.filter_query,
       filter_include_nulls = excluded.filter_include_nulls,
       updated_at = excluded.updated_at`,
    [
      payload.id,
      payload.title ?? '',
      payload.description ?? null,
      payload.filters?.filter ?? '',
      payload.filters?.filter_include_nulls ? 1 : 0,
      payload.updated ?? null,
    ],
  );
  notify('saved_filters');
}

export async function deleteSavedFilterByServerId(
  serverId: number,
): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM saved_filters WHERE server_id = ?', [serverId]);
  notify('saved_filters');
}

/** Remove rows whose server_id is not in the given set (sync reconcile). */
export async function pruneSavedFilters(keepServerIds: number[]): Promise<void> {
  const db = await getDb();
  if (keepServerIds.length === 0) {
    await db.execute('DELETE FROM saved_filters');
  } else {
    const placeholders = keepServerIds.map(() => '?').join(', ');
    await db.execute(
      `DELETE FROM saved_filters WHERE server_id NOT IN (${placeholders})`,
      keepServerIds,
    );
  }
  notify('saved_filters');
}
