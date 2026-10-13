import { describe, expect, it } from 'vitest';
import {
  parseBucketConfiguration,
  serializeBucketConfiguration,
  validateBucketConfiguration,
} from '@/lib/bucketConfig';
import { buildFilterColumns } from '@/queries/kanban';
import type { Task } from '@/domain/task';

const raw = JSON.stringify([
  { title: 'Urgent', filter: { filter: 'priority >= 4', filter_include_nulls: true, filter_timezone: 'Europe/London' } },
  { title: 'Rest', filter: { filter: '' } },
]);

describe('parseBucketConfiguration', () => {
  it('reads titles, filters and include-nulls', () => {
    expect(parseBucketConfiguration(raw)).toEqual([
      { title: 'Urgent', filter: 'priority >= 4', includeNulls: true },
      { title: 'Rest', filter: '', includeNulls: false },
    ]);
  });

  it('is empty for null, junk or non-array JSON', () => {
    expect(parseBucketConfiguration(null)).toEqual([]);
    expect(parseBucketConfiguration('nope')).toEqual([]);
    expect(parseBucketConfiguration('{"a":1}')).toEqual([]);
  });
});

describe('serializeBucketConfiguration', () => {
  it('round-trips and keeps fields the editor does not surface', () => {
    const configs = parseBucketConfiguration(raw);
    configs[0]!.filter = 'priority >= 3';
    const out = JSON.parse(serializeBucketConfiguration(configs, raw));
    expect(out[0].filter).toEqual({
      filter: 'priority >= 3',
      filter_include_nulls: true,
      filter_timezone: 'Europe/London',
    });
    expect(out[1].title).toBe('Rest');
  });

  it('trims and works without a previous value', () => {
    const out = JSON.parse(
      serializeBucketConfiguration([{ title: ' A ', filter: ' done = false ', includeNulls: false }]),
    );
    expect(out).toEqual([{ title: 'A', filter: { filter: 'done = false', filter_include_nulls: false } }]);
  });
});

describe('validateBucketConfiguration', () => {
  it('needs at least one titled bucket', () => {
    expect(validateBucketConfiguration([])).toMatch(/at least one/);
    expect(validateBucketConfiguration([{ title: ' ', filter: '', includeNulls: false }])).toMatch(/needs a title/);
  });

  it('accepts an empty filter and a valid one', () => {
    expect(
      validateBucketConfiguration([
        { title: 'All', filter: '', includeNulls: false },
        { title: 'Hot', filter: 'priority >= 3', includeNulls: false },
      ]),
    ).toBeNull();
  });

  it('reports an unparseable filter', () => {
    expect(
      validateBucketConfiguration([{ title: 'Bad', filter: 'priority >=', includeNulls: false }]),
    ).toMatch(/Bad/);
  });
});

describe('buildFilterColumns', () => {
  const t = (localId: string) => ({ localId, title: localId }) as unknown as Task;
  it('makes one read-only column per bucket from the match sets', () => {
    const cols = buildFilterColumns(
      { localId: 'v1' },
      [
        { title: 'A', filter: '', includeNulls: false },
        { title: 'B', filter: '', includeNulls: false },
      ],
      [new Set(['x', 'y']), new Set(['y'])],
      [t('x'), t('y'), t('z')],
    );
    expect(cols.map((c) => c.bucket.title)).toEqual(['A', 'B']);
    expect(cols[0]!.tasks.map((x) => x.localId)).toEqual(['x', 'y']);
    expect(cols[1]!.tasks.map((x) => x.localId)).toEqual(['y']);
    expect(cols[0]!.bucket.serverId).toBeNull();
    expect(cols[0]!.bucket.localId).not.toBe(cols[1]!.bucket.localId);
  });

  it('shows empty columns while match sets are still loading', () => {
    const cols = buildFilterColumns({ localId: 'v1' }, [{ title: 'A', filter: '', includeNulls: false }], [], [t('x')]);
    expect(cols[0]!.tasks).toEqual([]);
  });
});
