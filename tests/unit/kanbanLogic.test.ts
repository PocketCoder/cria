import { describe, expect, it } from 'vitest';
import type { KanbanColumn } from '@/queries/kanban';
import type { TaskBucket } from '@/domain/bucket';
import {
  applyBucketOrder,
  bucketRoles,
  buildKanbanTaskInput,
  findSourceColumn,
  findTaskInColumns,
  formatShortDate,
  isAtLimit,
  parseBucketLimit,
} from '@/features/kanban/kanbanLogic';

const col = (bucketId: string, taskIds: string[]) =>
  ({
    bucket: { localId: bucketId },
    tasks: taskIds.map((id) => ({ localId: id, title: id })),
    taskPositions: {},
  }) as unknown as KanbanColumn;

describe('applyBucketOrder', () => {
  const existing: TaskBucket[] = [
    { taskLocalId: 'a', viewLocalId: 'v', bucketLocalId: 'b1', position: 1 },
    { taskLocalId: 'x', viewLocalId: 'v', bucketLocalId: 'b2', position: 2 },
    { taskLocalId: 'a', viewLocalId: 'other', bucketLocalId: 'b1', position: 3 },
  ];

  it('rewrites the moving tasks under the target bucket with spread positions', () => {
    const out = applyBucketOrder(existing, 'v', 'b2', ['a', 'x']);
    const mine = out.filter((r) => r.viewLocalId === 'v');
    expect(mine).toEqual([
      { taskLocalId: 'a', viewLocalId: 'v', bucketLocalId: 'b2', position: 1024 },
      { taskLocalId: 'x', viewLocalId: 'v', bucketLocalId: 'b2', position: 2048 },
    ]);
  });

  it('leaves other views alone', () => {
    const out = applyBucketOrder(existing, 'v', 'b2', ['a']);
    expect(out).toContainEqual(existing[2]);
  });
});

describe('column lookups', () => {
  const cols = [col('b1', ['a', 'b']), col('b2', ['c'])];
  it('finds the source column and task', () => {
    expect(findSourceColumn('c', cols)?.bucket.localId).toBe('b2');
    expect(findSourceColumn('zzz', cols)).toBeUndefined();
    expect(findTaskInColumns('b', cols)?.localId).toBe('b');
    expect(findTaskInColumns('zzz', cols)).toBeUndefined();
  });
});

describe('formatShortDate', () => {
  it('formats a date and falls back to the raw value', () => {
    expect(formatShortDate('2030-03-05T12:00:00Z')).toMatch(/5/);
    expect(formatShortDate('garbage')).toBeTruthy();
  });
});

describe('bucket helpers', () => {
  it('parses limit drafts to non-negative ints', () => {
    expect(parseBucketLimit('3')).toBe(3);
    expect(parseBucketLimit('')).toBe(0);
    expect(parseBucketLimit('abc')).toBe(0);
    expect(parseBucketLimit('-2')).toBe(0);
    expect(parseBucketLimit('4.9')).toBe(4);
  });

  it('flags the limit only when set and reached', () => {
    expect(isAtLimit(0, 10)).toBe(false);
    expect(isAtLimit(3, 2)).toBe(false);
    expect(isAtLimit(3, 3)).toBe(true);
    expect(isAtLimit(3, 5)).toBe(true);
  });

  it('detects done and default buckets only for synced buckets', () => {
    const view = { doneBucketServerId: 5, defaultBucketServerId: 6 };
    expect(bucketRoles({ serverId: 5 }, view)).toEqual({ isDone: true, isDefault: false });
    expect(bucketRoles({ serverId: 6 }, view)).toEqual({ isDone: false, isDefault: true });
    expect(bucketRoles({ serverId: null }, { doneBucketServerId: null, defaultBucketServerId: null })).toEqual({
      isDone: false,
      isDefault: false,
    });
  });
});

describe('buildKanbanTaskInput', () => {
  it('returns null for a blank title', () => {
    expect(buildKanbanTaskInput('   ', 'p1')).toBeNull();
  });

  it('parses priority and labels out of the title', () => {
    const r = buildKanbanTaskInput('Write report !3 *work', 'p1')!;
    expect(r.input.projectLocalId).toBe('p1');
    expect(r.input.priority).toBe(3);
    expect(r.input.title).toBe('Write report');
    expect(r.labelTitles).toEqual(['work']);
  });

  it('falls back to the raw text when parsing leaves no title', () => {
    const r = buildKanbanTaskInput('!2', 'p1')!;
    expect(r.input.title).toBe('!2');
  });
});
