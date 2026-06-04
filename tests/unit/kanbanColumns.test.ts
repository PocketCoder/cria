// Pure-logic tests for kanban column assembly (assignments, done bucket,
// default-bucket fallback) — the behaviour behind "move card to bucket".

import { describe, it, expect } from 'vitest';
import { buildKanbanColumns } from '@/queries/kanban';
import type { Task } from '@/domain/task';
import type { Bucket } from '@/domain/bucket';
import type { ProjectView } from '@/domain/view';

function mkTask(p: Partial<Task>): Task {
  return {
    localId: p.localId ?? 't',
    serverId: p.serverId ?? null,
    projectLocalId: 'proj',
    title: p.title ?? 'Task',
    description: null,
    done: p.done ?? false,
    doneAt: null,
    dueDate: null,
    startDate: null,
    endDate: null,
    priority: 0,
    percentDone: 0,
    hexColor: null,
    position: null,
    isFavorite: false,
    isSubscribed: false,
    repeatAfter: 0,
    repeatMode: 0,
    updatedAt: '2024-01-01T00:00:00Z',
    identifier: null,
  };
}

function mkBucket(localId: string, serverId: number | null, position: number): Bucket {
  return {
    localId,
    serverId,
    viewLocalId: 'v1',
    title: localId,
    position,
    limit: 0,
    createdByServerId: null,
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function mkView(p: Partial<ProjectView> = {}): ProjectView {
  return {
    localId: 'v1',
    serverId: 1,
    projectLocalId: 'proj',
    title: 'Board',
    viewKind: 'kanban',
    position: 0,
    filter: null,
    bucketConfigurationMode: 'manual',
    bucketConfiguration: null,
    defaultBucketServerId: p.defaultBucketServerId ?? null,
    doneBucketServerId: p.doneBucketServerId ?? null,
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

const b1 = mkBucket('b1', 10, 0);
const b2 = mkBucket('b2', 20, 1);

function byBucket(cols: ReturnType<typeof buildKanbanColumns>) {
  return Object.fromEntries(
    cols.map((c) => [c.bucket.localId, c.tasks.map((t) => t.localId)]),
  );
}

describe('buildKanbanColumns', () => {
  it('places an explicitly-assigned task in its bucket, not the default', () => {
    const t1 = mkTask({ localId: 't1' });
    const t2 = mkTask({ localId: 't2' });
    const cols = buildKanbanColumns(
      mkView(),
      [b1, b2],
      [{ taskLocalId: 't1', bucketLocalId: 'b2' }],
      [t1, t2],
    );
    // t1 sits in b2 (its assignment); t2 falls into the leftmost (b1).
    expect(byBucket(cols)).toEqual({ b1: ['t2'], b2: ['t1'] });
  });

  it('reflects a move: reassigning a task moves it out of the fallback bucket', () => {
    const t1 = mkTask({ localId: 't1' });
    // Before: unassigned → leftmost.
    const before = buildKanbanColumns(mkView(), [b1, b2], [], [t1]);
    expect(byBucket(before)).toEqual({ b1: ['t1'], b2: [] });
    // After dropping onto b2.
    const after = buildKanbanColumns(
      mkView(),
      [b1, b2],
      [{ taskLocalId: 't1', bucketLocalId: 'b2' }],
      [t1],
    );
    expect(byBucket(after)).toEqual({ b1: [], b2: ['t1'] });
  });

  it('routes done tasks to the configured done bucket', () => {
    const done = mkTask({ localId: 'd', done: true });
    const open = mkTask({ localId: 'o' });
    const cols = buildKanbanColumns(
      mkView({ doneBucketServerId: 20 }), // b2 is the done bucket
      [b1, b2],
      [],
      [done, open],
    );
    expect(byBucket(cols)).toEqual({ b1: ['o'], b2: ['d'] });
  });

  it('falls done tasks back to the default bucket when no done bucket is set', () => {
    const done = mkTask({ localId: 'd', done: true });
    const cols = buildKanbanColumns(
      mkView({ defaultBucketServerId: 20 }), // default = b2
      [b1, b2],
      [],
      [done],
    );
    expect(byBucket(cols)).toEqual({ b1: [], b2: ['d'] });
  });
});
