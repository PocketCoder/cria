import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables } from './_helpers';
import { listSavedFilters, upsertSavedFilterFromServer } from '@/db/savedFilters';
import {
  createSavedFilter,
  updateSavedFilter,
  deleteSavedFilter,
} from '@/api/savedFilters';

const { mockCallApi, mockCreateApiClient } = vi.hoisted(() => ({
  mockCallApi: vi.fn(),
  mockCreateApiClient: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  callApi: mockCallApi,
  createApiClient: mockCreateApiClient,
}));

const mockClient = { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() };

async function pseudoProjectIds(): Promise<number[]> {
  const db = await getDb();
  const rows = await db.select<{ server_id: number }[]>(
    'SELECT server_id FROM projects WHERE server_id < -1 AND deleted = 0 ORDER BY server_id',
  );
  return rows.map((r) => r.server_id);
}

describe('api/savedFilters', () => {
  beforeAll(initSchema);
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCreateApiClient.mockReturnValue(mockClient);
    await clearTables();
  });

  it('createSavedFilter PUTs /filters and mirrors filter + pseudo-project locally', async () => {
    mockCallApi.mockResolvedValue({
      id: 4,
      title: 'High prio',
      description: 'desc',
      filters: { filter: 'priority >= 3', filter_include_nulls: false },
      updated: '2026-07-01T00:00:00Z',
    });

    const created = await createSavedFilter({
      title: 'High prio',
      description: 'desc',
      filter: 'priority >= 3',
      filterIncludeNulls: false,
    });

    expect(mockClient.PUT).toHaveBeenCalledWith('/filters', {
      body: {
        title: 'High prio',
        description: 'desc',
        filters: { filter: 'priority >= 3', filter_include_nulls: false },
      },
    });
    expect(created.serverId).toBe(4);
    expect((await listSavedFilters()).map((f) => f.serverId)).toEqual([4]);
    expect(await pseudoProjectIds()).toEqual([-5]); // -(4)-1
  });

  it('updateSavedFilter POSTs /filters/{id} and updates local rows', async () => {
    await upsertSavedFilterFromServer({
      id: 4, title: 'Old', filters: { filter: 'done = false' },
    });
    mockCallApi.mockResolvedValue({
      id: 4,
      title: 'New title',
      filters: { filter: 'done = true', filter_include_nulls: true },
      updated: '2026-07-02T00:00:00Z',
    });

    await updateSavedFilter(4, {
      title: 'New title',
      filter: 'done = true',
      filterIncludeNulls: true,
    });

    expect(mockClient.POST).toHaveBeenCalledWith('/filters/{id}', {
      params: { path: { id: 4 } },
      body: {
        title: 'New title',
        description: undefined,
        filters: { filter: 'done = true', filter_include_nulls: true },
      },
    });
    const filters = await listSavedFilters();
    expect(filters[0].title).toBe('New title');
    expect(filters[0].filterIncludeNulls).toBe(true);
  });

  it('deleteSavedFilter DELETEs /filters/{id} and removes local rows', async () => {
    const db = await getDb();
    await upsertSavedFilterFromServer({
      id: 4, title: 'Bye', filters: { filter: 'done = false' },
    });
    await db.execute(
      `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)`,
      ['proj_-5', -5, 'Bye', new Date().toISOString()],
    );
    mockCallApi.mockResolvedValue(undefined);

    await deleteSavedFilter(4);

    expect(mockClient.DELETE).toHaveBeenCalledWith('/filters/{id}', {
      params: { path: { id: 4 } },
    });
    expect(await listSavedFilters()).toEqual([]);
    expect(await pseudoProjectIds()).toEqual([]);
  });
});
