import { describe, expect, it } from 'vitest';
import {
  countChecklistItems,
  countSuppressedSignals,
  formatDue,
  isOverdue,
} from '@/features/tasks/taskRowHelpers';

const none = {
  labelCount: 0,
  hasAttachments: false,
  checklistTotal: 0,
  repeatAfter: 0,
  percentDone: 0,
  hexColor: null,
};

describe('countSuppressedSignals', () => {
  it('is zero for a bare task', () => {
    expect(countSuppressedSignals(none)).toBe(0);
  });

  it('counts each signal once', () => {
    expect(
      countSuppressedSignals({
        labelCount: 3,
        hasAttachments: true,
        checklistTotal: 2,
        repeatAfter: 86400,
        percentDone: 0.5,
        hexColor: 'ff0000',
      }),
    ).toBe(6);
  });

  it('counts a single signal', () => {
    expect(countSuppressedSignals({ ...none, hasAttachments: true })).toBe(1);
    expect(countSuppressedSignals({ ...none, hexColor: '' })).toBe(0);
  });
});

describe('countChecklistItems', () => {
  it('handles empty input', () => {
    expect(countChecklistItems(null)).toEqual({ checked: 0, total: 0 });
    expect(countChecklistItems('')).toEqual({ checked: 0, total: 0 });
  });

  it('counts checked and total checkboxes', () => {
    const html =
      '<input type="checkbox" checked="checked"><input type="checkbox"><input type="checkbox" checked>';
    expect(countChecklistItems(html)).toEqual({ checked: 2, total: 3 });
  });
});

describe('due helpers', () => {
  it('flags past dates as overdue and future ones as not', () => {
    expect(isOverdue('2000-01-01T00:00:00Z')).toBe(true);
    expect(isOverdue('2999-01-01T00:00:00Z')).toBe(false);
  });

  it('falls back to the raw value on garbage input', () => {
    expect(isOverdue('not-a-date')).toBe(false);
    expect(formatDue('not-a-date')).toBe('not-a-date');
  });

  it('formats a date-only value as day and month', () => {
    expect(formatDue('2030-03-05T00:00:00Z')).toMatch(/^\d{1,2} Mar/);
  });
});
