// Pure-logic tests for the kanban board filter.

import { describe, it, expect } from 'vitest';
import {
  EMPTY_BOARD_FILTER,
  isBoardFilterActive,
  taskMatchesBoardFilter,
  type BoardFilter,
} from '@/features/kanban/boardFilter';
import type { Task } from '@/domain/task';

function mkTask(p: Partial<Task>): Task {
  return {
    localId: p.localId ?? 't',
    serverId: null,
    projectLocalId: 'p',
    title: p.title ?? 'Task',
    description: p.description ?? null,
    done: p.done ?? false,
    doneAt: null,
    dueDate: null,
    startDate: null,
    endDate: null,
    priority: p.priority ?? 0,
    percentDone: 0,
    hexColor: null,
    position: null,
    isFavorite: false,
    isSubscribed: false,
    repeatAfter: 0,
    repeatMode: 0,
    updatedAt: '2024-01-01T00:00:00Z',
    createdAt: null,
    createdById: null,
    identifier: null,
  };
}

const f = (over: Partial<BoardFilter>): BoardFilter => ({ ...EMPTY_BOARD_FILTER, ...over });

describe('isBoardFilterActive', () => {
  it('is false for the empty filter and true once any constraint is set', () => {
    expect(isBoardFilterActive(EMPTY_BOARD_FILTER)).toBe(false);
    expect(isBoardFilterActive(f({ text: 'x' }))).toBe(true);
    expect(isBoardFilterActive(f({ minPriority: 2 }))).toBe(true);
    expect(isBoardFilterActive(f({ labelLocalIds: ['l1'] }))).toBe(true);
    expect(isBoardFilterActive(f({ showDone: false }))).toBe(true);
  });
});

describe('taskMatchesBoardFilter', () => {
  it('passes everything under the empty filter', () => {
    expect(taskMatchesBoardFilter(mkTask({ done: true }), EMPTY_BOARD_FILTER, [])).toBe(true);
  });

  it('text matches title or description, case-insensitively', () => {
    const t = mkTask({ title: 'Fix the Bug', description: 'in parser' });
    expect(taskMatchesBoardFilter(t, f({ text: 'bug' }), [])).toBe(true);
    expect(taskMatchesBoardFilter(t, f({ text: 'PARSER' }), [])).toBe(true);
    expect(taskMatchesBoardFilter(t, f({ text: 'nope' }), [])).toBe(false);
  });

  it('minPriority excludes lower-priority tasks', () => {
    expect(taskMatchesBoardFilter(mkTask({ priority: 1 }), f({ minPriority: 3 }), [])).toBe(false);
    expect(taskMatchesBoardFilter(mkTask({ priority: 4 }), f({ minPriority: 3 }), [])).toBe(true);
  });

  it('showDone=false hides done tasks', () => {
    expect(taskMatchesBoardFilter(mkTask({ done: true }), f({ showDone: false }), [])).toBe(false);
    expect(taskMatchesBoardFilter(mkTask({ done: false }), f({ showDone: false }), [])).toBe(true);
  });

  it('label filter requires ANY of the selected labels', () => {
    const filter = f({ labelLocalIds: ['a', 'b'] });
    expect(taskMatchesBoardFilter(mkTask({}), filter, ['b', 'c'])).toBe(true);
    expect(taskMatchesBoardFilter(mkTask({}), filter, ['c'])).toBe(false);
    expect(taskMatchesBoardFilter(mkTask({}), filter, [])).toBe(false);
  });

  it('combines constraints (all must pass)', () => {
    const filter = f({ text: 'api', minPriority: 2, labelLocalIds: ['l1'] });
    const t = mkTask({ title: 'API work', priority: 3 });
    expect(taskMatchesBoardFilter(t, filter, ['l1'])).toBe(true);
    expect(taskMatchesBoardFilter(t, filter, ['l2'])).toBe(false); // wrong label
    expect(taskMatchesBoardFilter(mkTask({ title: 'API', priority: 1 }), filter, ['l1'])).toBe(false); // low priority
  });
});
