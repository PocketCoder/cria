import { type ApiClient, callApi, createApiClient } from './client';
import {
  deleteSavedFilterByServerId,
  type SavedFilter,
  type SavedFilterPayload,
} from '@/db/savedFilters';
import { getDb, withTx } from '@/db';
import { notify } from '@/db/bus';
import { nanoid } from 'nanoid';

export interface SavedFilterInput {
  title: string;
  description?: string;
  filter: string;
  filterIncludeNulls: boolean;
}

function toBody(input: SavedFilterInput) {
  return {
    title: input.title,
    description: input.description,
    filters: {
      filter: input.filter,
      filter_include_nulls: input.filterIncludeNulls,
    },
  };
}

/** Mirror the API result into saved_filters + the pseudo-project row the
 * server will report on the next GET /projects (id = -filterId - 1). */
async function mirrorLocally(payload: SavedFilterPayload): Promise<void> {
  const serverId = payload.id;
  if (typeof serverId !== 'number') return;
  const now = new Date().toISOString();
  await withTx(async (tx) => {
    await tx.execute(
      `INSERT INTO saved_filters
         (server_id, title, description, filter_query, filter_include_nulls, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET
         title             = excluded.title,
         description       = excluded.description,
         filter_query      = excluded.filter_query,
         filter_include_nulls = excluded.filter_include_nulls,
         updated_at        = excluded.updated_at`,
      [
        serverId,
        payload.title ?? '',
        payload.description ?? null,
        payload.filters?.filter ?? '',
        payload.filters?.filter_include_nulls ? 1 : 0,
        payload.updated ?? null,
      ],
    );
    await tx.execute(
      `INSERT INTO projects
         (local_id, server_id, title, updated_at, synced_at, dirty, deleted)
       VALUES (?, ?, ?, ?, ?, 0, 0)
       ON CONFLICT(server_id) DO UPDATE SET
         title      = excluded.title,
         updated_at = excluded.updated_at,
         synced_at  = excluded.synced_at,
         dirty      = 0,
         deleted    = 0`,
      [
        nanoid(),
        -serverId - 1,
        payload.title ?? '',
        now,
        now,
      ],
    );
  });
  notify('saved_filters');
  notify('projects');
}

export async function createSavedFilter(
  input: SavedFilterInput,
  client: ApiClient = createApiClient(),
): Promise<SavedFilter> {
  const data = (await callApi(
    client.PUT('/filters', { body: toBody(input) as never }),
  )) as SavedFilterPayload;
  await mirrorLocally(data);
  return {
    serverId: data.id ?? 0,
    title: data.title ?? input.title,
    description: data.description ?? null,
    filterQuery: data.filters?.filter ?? input.filter,
    filterIncludeNulls: data.filters?.filter_include_nulls ?? input.filterIncludeNulls,
    updatedAt: data.updated ?? null,
  };
}

export async function updateSavedFilter(
  serverId: number,
  input: SavedFilterInput,
  client: ApiClient = createApiClient(),
): Promise<void> {
  const data = (await callApi(
    client.POST('/filters/{id}', {
      params: { path: { id: serverId } },
      // Generated schema says `requestBody?: never` for the /filters
      // endpoints (upstream swagger gap) — the API does take this body.
      body: toBody(input) as never,
    }),
  )) as SavedFilterPayload;
  await mirrorLocally({ ...data, id: data.id ?? serverId });
}

export async function deleteSavedFilter(
  serverId: number,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.DELETE('/filters/{id}', { params: { path: { id: serverId } } }),
  );
  await deleteSavedFilterByServerId(serverId);
  const db = await getDb();
  await db.execute('DELETE FROM projects WHERE server_id = ?', [-serverId - 1]);
  notify('projects');
}
