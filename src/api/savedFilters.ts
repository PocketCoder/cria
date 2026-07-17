import { type ApiClient, callApi, createApiClient } from './client';
import { upsertProjectFromServer } from '@/db/projects';
import {
  upsertSavedFilterFromServer,
  deleteSavedFilterByServerId,
  type SavedFilter,
  type SavedFilterPayload,
} from '@/db/savedFilters';
import { getDb } from '@/db';
import { notify } from '@/db/bus';

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
  await upsertSavedFilterFromServer(payload);
  if (typeof payload.id === 'number') {
    await upsertProjectFromServer({
      id: -payload.id - 1,
      title: payload.title ?? '',
      description: payload.description ?? null,
      updated: payload.updated ?? new Date().toISOString(),
    });
    notify('projects');
  }
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
