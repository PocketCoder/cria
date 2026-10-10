import { describe, it, expect } from 'vitest';
import {
  nextFireAt,
  isSummaryDue,
  morningSummary,
  weeklyRoundup,
  suggestTasks,
} from '@/lib/summaries';

// Sat 10 Oct 2026, 07:00 local.
const now = new Date(2026, 9, 10, 7, 0, 0);

const t = (title: string, dueDate: string | null, extra: object = {}) => ({
  title,
  dueDate,
  done: false,
  priority: 0,
  createdAt: '2026-01-01T00:00:00Z',
  ...extra,
});

describe('nextFireAt', () => {
  it('picks today when the time is still ahead', () => {
    expect(nextFireAt(now, '08:00')).toEqual(new Date(2026, 9, 10, 8, 0));
  });
  it('rolls to tomorrow when the time has passed', () => {
    expect(nextFireAt(now, '06:00')).toEqual(new Date(2026, 9, 11, 6, 0));
  });
  it('finds the next matching weekday (Monday = 1)', () => {
    expect(nextFireAt(now, '09:00', 1)).toEqual(new Date(2026, 9, 12, 9, 0));
  });
  it('waits a full week when today is the weekday but the time passed', () => {
    expect(nextFireAt(now, '06:00', 6)).toEqual(new Date(2026, 9, 17, 6, 0));
  });
});

describe('isSummaryDue', () => {
  const grace = 3 * 3_600_000;
  const at = (h: number, m = 0) => new Date(2026, 9, 10, h, m);
  it('is not due before the time', () => {
    expect(isSummaryDue(at(7, 59), '08:00', null, '2026-10-10', grace)).toBe(false);
  });
  it('is due after the time within grace', () => {
    expect(isSummaryDue(at(8, 1), '08:00', null, '2026-10-10', grace)).toBe(true);
  });
  it('is skipped once the grace window has passed', () => {
    expect(isSummaryDue(at(15), '08:00', null, '2026-10-10', grace)).toBe(false);
  });
  it('does not fire twice in a day', () => {
    expect(isSummaryDue(at(8, 1), '08:00', '2026-10-10', '2026-10-10', grace)).toBe(false);
  });
  it('respects the weekday', () => {
    expect(isSummaryDue(at(9, 1), '09:00', null, '2026-10-10', grace, 1)).toBe(false);
    expect(isSummaryDue(at(9, 1), '09:00', null, '2026-10-10', grace, 6)).toBe(true);
  });
});

describe('summary messages', () => {
  const open = [
    { title: 'Late', dueDate: '2026-10-08T00:00:00Z', done: false },
    { title: 'Now', dueDate: '2026-10-10T00:00:00Z', done: false },
    { title: 'Later', dueDate: '2026-10-13T00:00:00Z', done: false },
  ];
  it('morning counts today and overdue, naming the first due task', () => {
    expect(morningSummary(open, now)).toEqual({
      title: 'Today',
      body: '1 due today, 1 overdue. Start with: Now',
    });
  });
  it('morning handles an empty day', () => {
    expect(morningSummary([], now).body).toBe('Nothing due today.');
  });
  it('weekly summarises done, ahead and overdue', () => {
    expect(weeklyRoundup(open, 5, now).body).toBe(
      '5 tasks done last week, 2 due in the next 7 days, 1 overdue.',
    );
  });
});

describe('suggestTasks', () => {
  it('lists undated tasks (priority, then oldest) before far due dates', () => {
    const undated = [
      t('low', null, { priority: 1 }),
      t('high', null, { priority: 4 }),
    ];
    const dated = [
      t('soon', '2026-10-12T00:00:00Z'),
      t('far2', '2026-12-01T00:00:00Z'),
      t('far1', '2026-11-01T00:00:00Z'),
    ];
    expect(suggestTasks(undated, dated, now, 10).map((x) => x.title)).toEqual([
      'high',
      'low',
      'far1',
      'far2',
    ]);
  });
  it('caps the result', () => {
    const undated = [t('a', null), t('b', null), t('c', null), t('d', null)];
    expect(suggestTasks(undated, [], now)).toHaveLength(3);
  });
});
