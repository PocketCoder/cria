// Pure-logic tests for the Gantt tree builder + visibility filter.

import { describe, it, expect } from 'vitest';
import {
  buildGanttTaskTree,
  visibleGanttNodes,
  isoToDay,
} from '@/features/gantt/buildGanttTaskTree';
import type { Task } from '@/domain/task';

function mkTask(partial: Partial<Task>): Task {
  return {
    localId: partial.localId ?? Math.random().toString(36).slice(2),
    serverId: partial.serverId ?? null,
    projectLocalId: 'p1',
    title: partial.title ?? partial.localId ?? 'Task',
    description: null,
    done: partial.done ?? false,
    doneAt: null,
    dueDate: null,
    startDate: partial.startDate ?? null,
    endDate: partial.endDate ?? null,
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

describe('buildGanttTaskTree', () => {
  it('keeps flat order and reads own dates', () => {
    const a = mkTask({ localId: 'a', startDate: '2024-03-01T00:00:00Z', endDate: '2024-03-05T00:00:00Z' });
    const b = mkTask({ localId: 'b' }); // dateless
    const nodes = buildGanttTaskTree([a, b], new Map());

    expect(nodes.map((n) => n.task.localId)).toEqual(['a', 'b']);
    expect(nodes[0]!.startDay).toBe(isoToDay('2024-03-01T00:00:00Z'));
    expect(nodes[0]!.endDay).toBe(isoToDay('2024-03-05T00:00:00Z'));
    expect(nodes[0]!.hasOwnDates).toBe(true);
    expect(nodes[1]!.startDay).toBeNull();
    expect(nodes[1]!.hasOwnDates).toBe(false);
  });

  it('derives a dateless parent range from its children, depth-first', () => {
    const parent = mkTask({ localId: 'p' });
    const c1 = mkTask({ localId: 'c1', startDate: '2024-03-02T00:00:00Z', endDate: '2024-03-04T00:00:00Z' });
    const c2 = mkTask({ localId: 'c2', startDate: '2024-03-06T00:00:00Z', endDate: '2024-03-08T00:00:00Z' });
    const nodes = buildGanttTaskTree([parent, c1, c2], new Map([['p', ['c1', 'c2']]]));

    expect(nodes.map((n) => n.task.localId)).toEqual(['p', 'c1', 'c2']);
    const p = nodes[0]!;
    expect(p.isParent).toBe(true);
    expect(p.childIds).toEqual(['c1', 'c2']);
    expect(p.startDay).toBe(isoToDay('2024-03-02T00:00:00Z'));
    expect(p.endDay).toBe(isoToDay('2024-03-08T00:00:00Z'));
    expect(p.hasOwnDates).toBe(false);
    expect(p.hasDerivedDates).toBe(true);
  });

  it('caps indent depth at 4', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => mkTask({ localId: `n${i}` }));
    const childMap = new Map<string, string[]>();
    for (let i = 0; i < 5; i++) childMap.set(`n${i}`, [`n${i + 1}`]);
    const nodes = buildGanttTaskTree(tasks, childMap);

    expect(nodes.map((n) => n.indentLevel)).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it('treats a child of an absent parent as a root', () => {
    const x = mkTask({ localId: 'x', startDate: '2024-03-01T00:00:00Z' });
    const nodes = buildGanttTaskTree([x], new Map([['missing', ['x']]]));
    expect(nodes.map((n) => n.task.localId)).toEqual(['x']);
    expect(nodes[0]!.indentLevel).toBe(0);
  });
});

describe('visibleGanttNodes', () => {
  const parent = mkTask({ localId: 'p' });
  const c1 = mkTask({ localId: 'c1', startDate: '2024-03-02T00:00:00Z', endDate: '2024-03-04T00:00:00Z' });
  const c2 = mkTask({ localId: 'c2', startDate: '2024-03-06T00:00:00Z', endDate: '2024-03-08T00:00:00Z' });
  const tree = buildGanttTaskTree([parent, c1, c2], new Map([['p', ['c1', 'c2']]]));

  it('hides descendants of a collapsed node', () => {
    const v = visibleGanttNodes(tree, new Set(['p']), true);
    expect(v.map((n) => n.task.localId)).toEqual(['p']);
  });

  it('shows everything when nothing is collapsed', () => {
    const v = visibleGanttNodes(tree, new Set(), true);
    expect(v.map((n) => n.task.localId)).toEqual(['p', 'c1', 'c2']);
  });

  it('hides dateless leaves when the toggle is off, but keeps a derived-date parent', () => {
    const dateless = mkTask({ localId: 'd' });
    const withDateless = buildGanttTaskTree(
      [parent, c1, c2, dateless],
      new Map([['p', ['c1', 'c2']]]),
    );
    const v = visibleGanttNodes(withDateless, new Set(), false);
    // 'd' is hidden; 'p' has derived dates so it stays.
    expect(v.map((n) => n.task.localId)).toEqual(['p', 'c1', 'c2']);
  });
});
