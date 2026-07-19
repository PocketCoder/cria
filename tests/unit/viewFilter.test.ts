import { describe, it, expect } from 'vitest';
import { viewFilterParams } from '@/domain/view';
import type { ProjectView } from '@/domain/view';

const baseView: ProjectView = {
  localId: 'v1',
  serverId: 1,
  projectLocalId: 'p1',
  title: 'List',
  viewKind: 'list',
  position: 0,
  filter: null,
  bucketConfigurationMode: 'none',
  bucketConfiguration: null,
  defaultBucketServerId: null,
  doneBucketServerId: null,
  updatedAt: '2026-07-01T00:00:00Z',
};

describe('viewFilterParams', () => {
  it('extracts filter string + include_nulls from the stored TaskCollection JSON', () => {
    const view = {
      ...baseView,
      filter: JSON.stringify({ filter: 'priority >= 3', filter_include_nulls: true }),
    };
    expect(viewFilterParams(view)).toEqual({
      filter: 'priority >= 3',
      includeNulls: true,
    });
  });

  it('returns null for views without a filter', () => {
    expect(viewFilterParams(baseView)).toBeNull();
    expect(viewFilterParams({ ...baseView, filter: JSON.stringify({ filter: '' }) })).toBeNull();
  });

  it('returns null on malformed JSON instead of throwing', () => {
    expect(viewFilterParams({ ...baseView, filter: '{ broken json' })).toBeNull();
  });

  it('treats a bare string filter as the query itself (older server payloads)', () => {
    expect(viewFilterParams({ ...baseView, filter: 'done = false' })).toEqual({
      filter: 'done = false',
      includeNulls: false,
    });
  });
});
