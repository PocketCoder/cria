import { describe, expect, it } from 'vitest';
import {
  DATE_COLUMN_FIELD,
  EDITABLE_COLUMNS,
  clampPercent,
  cleanDraft,
  computeSortOrder,
  createdByLabel,
  fromDateInputValue,
  taskCountLabel,
  taskIndexLabel,
  toDateInputValue,
} from '@/features/table/tableLogic';
import type { VisibleState } from '@/features/table/useTableConfig';

describe('date input helpers', () => {
  it('round-trips midnight UTC', () => {
    expect(toDateInputValue('2030-05-17T00:00:00.000Z')).toBe('2030-05-17');
    expect(fromDateInputValue('2030-05-17')).toBe('2030-05-17T00:00:00.000Z');
  });
  it('handles empty and invalid values', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue('nope')).toBe('');
    expect(fromDateInputValue('')).toBeNull();
  });
});

describe('clampPercent', () => {
  it('clamps and zeroes non-numbers', () => {
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(40)).toBe(40);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});

describe('cleanDraft', () => {
  it('drops a blank title but keeps other fields', () => {
    expect(cleanDraft({ title: '   ', priority: 3 })).toEqual({ priority: 3 });
    expect(cleanDraft({ title: '' })).toEqual({});
  });
  it('keeps a real title and drafts without one', () => {
    const d = { title: 'x' };
    expect(cleanDraft(d)).toBe(d);
    expect(cleanDraft({ priority: 1 })).toEqual({ priority: 1 });
  });
});

describe('labels', () => {
  it('formats created-by', () => {
    expect(createdByLabel(null, 1)).toBe('—');
    expect(createdByLabel(undefined, 1)).toBe('—');
    expect(createdByLabel(1, 1)).toBe('You');
    expect(createdByLabel(2, 1)).toBe('#2');
  });
  it('formats the index column', () => {
    expect(taskIndexLabel({ identifier: 'ABC-1', serverId: 9 })).toBe('ABC-1');
    expect(taskIndexLabel({ identifier: '', serverId: 9 })).toBe('#9');
    expect(taskIndexLabel({ identifier: '', serverId: null })).toBe('—');
  });
  it('formats the task count header', () => {
    expect(taskCountLabel(0, 0, true)).toBe('Loading…');
    expect(taskCountLabel(0, 0, false)).toBe('No tasks');
    expect(taskCountLabel(1, 0, false)).toBe('1 task');
    expect(taskCountLabel(3, 2, false)).toBe('3 tasks');
    expect(taskCountLabel(0, 2, false)).toBe('0 tasks');
  });
});

describe('computeSortOrder', () => {
  const visible = { title: true, priority: true, dueDate: false } as unknown as VisibleState;
  it('is empty with a single active key', () => {
    expect(computeSortOrder({ title: 'asc' }, visible).size).toBe(0);
  });
  it('numbers multiple visible keys and ignores hidden ones', () => {
    const m = computeSortOrder({ title: 'asc', dueDate: 'desc', priority: 'desc' }, visible);
    expect([...m.entries()]).toEqual([
      ['title', 1],
      ['priority', 2],
    ]);
  });
});

describe('column tables', () => {
  it('maps date columns to task fields', () => {
    expect(DATE_COLUMN_FIELD.updated).toBe('updatedAt');
    expect(DATE_COLUMN_FIELD.created).toBe('createdAt');
    expect(DATE_COLUMN_FIELD.doneAt).toBe('doneAt');
  });
  it('lists editable columns', () => {
    expect(EDITABLE_COLUMNS.has('title')).toBe(true);
    expect(EDITABLE_COLUMNS.has('done')).toBe(false);
  });
});
