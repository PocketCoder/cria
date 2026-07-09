import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initSchema, clearTables } from './_helpers';
import {
  listSavedFilters,
  getSavedFilterByServerId,
  upsertSavedFilterFromServer,
  deleteSavedFilterByServerId,
  pruneSavedFilters,
} from '@/db/savedFilters';

describe('db/savedFilters', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  const payload = (id: number, title: string, filter = 'done = false') => ({
    id,
    title,
    description: null as string | null,
    filters: { filter, filter_include_nulls: false },
    updated: '2026-07-01T00:00:00Z',
  });

  it('upserts from server payload and lists ordered by title', async () => {
    await upsertSavedFilterFromServer(payload(2, 'Zebra'));
    await upsertSavedFilterFromServer(payload(1, 'Alpha', 'priority >= 3'));

    const filters = await listSavedFilters();
    expect(filters.map((f) => f.title)).toEqual(['Alpha', 'Zebra']);
    expect(filters[0]!.serverId).toBe(1);
    expect(filters[0]!.filterQuery).toBe('priority >= 3');
    expect(filters[0]!.filterIncludeNulls).toBe(false);
  });

  it('updates in place on repeated upsert of the same server id', async () => {
    await upsertSavedFilterFromServer(payload(1, 'Old title'));
    await upsertSavedFilterFromServer(payload(1, 'New title', 'done = true'));

    const filters = await listSavedFilters();
    expect(filters).toHaveLength(1);
    expect(filters[0]!.title).toBe('New title');
    expect(filters[0]!.filterQuery).toBe('done = true');
  });

  it('gets a filter by server id', async () => {
    await upsertSavedFilterFromServer(payload(7, 'Mine'));
    const f = await getSavedFilterByServerId(7);
    expect(f?.title).toBe('Mine');
    expect(await getSavedFilterByServerId(999)).toBeNull();
  });

  it('deletes by server id', async () => {
    await upsertSavedFilterFromServer(payload(1, 'A'));
    await upsertSavedFilterFromServer(payload(2, 'B'));
    await deleteSavedFilterByServerId(1);
    expect((await listSavedFilters()).map((f) => f.serverId)).toEqual([2]);
  });

  it('prunes rows not in the keep set', async () => {
    await upsertSavedFilterFromServer(payload(1, 'A'));
    await upsertSavedFilterFromServer(payload(2, 'B'));
    await upsertSavedFilterFromServer(payload(3, 'C'));
    await pruneSavedFilters([1, 3]);
    expect((await listSavedFilters()).map((f) => f.serverId)).toEqual([1, 3]);
  });

  it('prune with empty keep set removes everything', async () => {
    await upsertSavedFilterFromServer(payload(1, 'A'));
    await pruneSavedFilters([]);
    expect(await listSavedFilters()).toEqual([]);
  });
});
