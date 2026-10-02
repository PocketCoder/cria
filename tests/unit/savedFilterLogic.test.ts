import { describe, expect, it } from 'vitest';
import {
  buildFilterInput,
  canSaveFilter,
  filterParseError,
  initialFilterForm,
} from '@/features/smart-views/savedFilterLogic';
import type { SavedFilter } from '@/db/savedFilters';

const NOW = new Date('2026-01-05T09:00:00Z');

describe('savedFilterLogic', () => {
  it('starts blank for a new filter and seeds from an existing one', () => {
    expect(initialFilterForm(null)).toEqual({
      title: '',
      description: '',
      query: '',
      includeNulls: false,
    });
    const existing = {
      title: 'High',
      description: 'urgent',
      filterQuery: 'priority >= 3',
      filterIncludeNulls: true,
    } as SavedFilter;
    expect(initialFilterForm(existing)).toEqual({
      title: 'High',
      description: 'urgent',
      query: 'priority >= 3',
      includeNulls: true,
    });
  });

  it('only reports a parse error for a non-blank, invalid query', () => {
    expect(filterParseError('   ', NOW)).toBeNull();
    expect(filterParseError('done = false && priority >= 3', NOW)).toBeNull();
    expect(typeof filterParseError('priority >=', NOW)).toBe('string');
  });

  it('needs a connection, a title and a valid query, and not to be busy', () => {
    const ok = { online: true, busy: false, title: 'T', query: 'done = false', parseError: null };
    expect(canSaveFilter(ok)).toBe(true);
    expect(canSaveFilter({ ...ok, online: false })).toBe(false);
    expect(canSaveFilter({ ...ok, busy: true })).toBe(false);
    expect(canSaveFilter({ ...ok, title: '  ' })).toBe(false);
    expect(canSaveFilter({ ...ok, query: ' ' })).toBe(false);
    expect(canSaveFilter({ ...ok, parseError: 'bad' })).toBe(false);
  });

  it('trims fields and drops an empty description', () => {
    expect(
      buildFilterInput({ title: ' T ', description: '  ', query: ' done = false ', includeNulls: true }),
    ).toEqual({
      title: 'T',
      description: undefined,
      filter: 'done = false',
      filterIncludeNulls: true,
    });
  });
});
