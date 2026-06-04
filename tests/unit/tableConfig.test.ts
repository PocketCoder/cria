// Pure-logic tests for the table view: sort cycling + multi-column sort.
// (The localStorage-backed hook isn't exercised here — vitest runs under
// the node environment, where localStorage is absent.)

import { describe, it, expect } from 'vitest';
import {
  cycleSort,
  sortTasks,
  type SortState,
} from '@/features/table/useTableConfig';
import type { Task } from '@/domain/task';

function mkTask(partial: Partial<Task>): Task {
  return {
    localId: partial.localId ?? Math.random().toString(36).slice(2),
    serverId: partial.serverId ?? null,
    projectLocalId: partial.projectLocalId ?? 'p1',
    title: partial.title ?? 'Task',
    description: null,
    done: partial.done ?? false,
    doneAt: partial.doneAt ?? null,
    dueDate: partial.dueDate ?? null,
    startDate: partial.startDate ?? null,
    endDate: partial.endDate ?? null,
    priority: partial.priority ?? 0,
    percentDone: partial.percentDone ?? 0,
    hexColor: null,
    position: null,
    isFavorite: false,
    isSubscribed: false,
    repeatAfter: 0,
    repeatMode: 0,
    updatedAt: partial.updatedAt ?? '2024-01-01T00:00:00Z',
    createdAt: partial.createdAt ?? null,
    createdById: partial.createdById ?? null,
    identifier: partial.identifier ?? null,
  };
}

describe('cycleSort', () => {
  it('cycles none → desc → asc → removed (non-additive)', () => {
    let s: SortState = {};
    s = cycleSort(s, 'title', false);
    expect(s).toEqual({ title: 'desc' });
    s = cycleSort(s, 'title', false);
    expect(s).toEqual({ title: 'asc' });
    s = cycleSort(s, 'title', false);
    expect(s).toEqual({});
  });

  it('non-additive click replaces existing sort columns', () => {
    const s = cycleSort({ priority: 'asc' }, 'title', false);
    expect(s).toEqual({ title: 'desc' });
  });

  it('additive click keeps existing columns and appends the new one', () => {
    const s = cycleSort({ priority: 'desc' }, 'title', true);
    expect(Object.keys(s)).toEqual(['priority', 'title']);
    expect(s).toEqual({ priority: 'desc', title: 'desc' });
  });

  it('additive direction change preserves priority order', () => {
    const s = cycleSort({ priority: 'desc', title: 'desc' }, 'priority', true);
    expect(Object.keys(s)).toEqual(['priority', 'title']);
    expect(s.priority).toBe('asc');
  });

  it('additive removal drops only that column', () => {
    const s = cycleSort({ priority: 'asc', title: 'asc' }, 'priority', true);
    expect(s).toEqual({ title: 'asc' });
  });
});

describe('sortTasks', () => {
  const a = mkTask({ localId: 'a', title: 'Apple', priority: 1, dueDate: '2024-03-01T00:00:00Z' });
  const b = mkTask({ localId: 'b', title: 'Banana', priority: 3, dueDate: null });
  const c = mkTask({ localId: 'c', title: 'Cherry', priority: 2, dueDate: '2024-01-01T00:00:00Z' });

  it('sorts by title ascending / descending', () => {
    expect(sortTasks([c, a, b], { title: 'asc' }).map((t) => t.localId)).toEqual(['a', 'b', 'c']);
    expect(sortTasks([c, a, b], { title: 'desc' }).map((t) => t.localId)).toEqual(['c', 'b', 'a']);
  });

  it('sorts dates with nulls last regardless of direction', () => {
    expect(sortTasks([a, b, c], { dueDate: 'asc' }).map((t) => t.localId)).toEqual(['c', 'a', 'b']);
    expect(sortTasks([a, b, c], { dueDate: 'desc' }).map((t) => t.localId)).toEqual(['a', 'c', 'b']);
  });

  it('applies multi-column priority (first key wins ties)', () => {
    const x = mkTask({ localId: 'x', priority: 1, title: 'Zed' });
    const y = mkTask({ localId: 'y', priority: 1, title: 'Aaa' });
    const z = mkTask({ localId: 'z', priority: 2, title: 'Mid' });
    const sorted = sortTasks([x, y, z], { priority: 'desc', title: 'asc' });
    // priority desc puts z first; the two priority-1 tasks break ties by title asc.
    expect(sorted.map((t) => t.localId)).toEqual(['z', 'y', 'x']);
  });

  it('ignores sort keys for hidden columns', () => {
    const sorted = sortTasks([c, a, b], { title: 'asc' }, { visible: { title: false } as any });
    // title hidden → no active sort → original order preserved
    expect(sorted.map((t) => t.localId)).toEqual(['c', 'a', 'b']);
  });

  it('sorts by created (date) and createdBy (id)', () => {
    const p = mkTask({ localId: 'p', createdAt: '2024-01-03T00:00:00Z', createdById: 5 });
    const q = mkTask({ localId: 'q', createdAt: '2024-01-01T00:00:00Z', createdById: 9 });
    expect(sortTasks([p, q], { created: 'asc' }).map((t) => t.localId)).toEqual(['q', 'p']);
    expect(sortTasks([p, q], { createdBy: 'desc' }).map((t) => t.localId)).toEqual(['q', 'p']);
  });

  it('ignores non-sortable columns (labels)', () => {
    const sorted = sortTasks([c, a, b], { labels: 'asc' } as SortState);
    expect(sorted.map((t) => t.localId)).toEqual(['c', 'a', 'b']);
  });

  it('returns a new array without mutating the input', () => {
    const input = [c, a, b];
    const sorted = sortTasks(input, { title: 'asc' });
    expect(input.map((t) => t.localId)).toEqual(['c', 'a', 'b']);
    expect(sorted).not.toBe(input);
  });
});
