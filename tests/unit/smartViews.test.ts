import { describe, it, expect } from 'vitest';
import { groupToday, upcomingFrom } from '@/queries/smartViews';
import type { TaskWithProject } from '@/db/tasks';

// Due dates are UTC-midnight ISOs (Vikunja convention); "now" is local.
const task = (id: string, dueDate: string | null) =>
  ({ localId: id, dueDate, projectTitle: 'P' }) as unknown as TaskWithProject;
const ids = (ts: TaskWithProject[]) => ts.map((t) => t.localId);

const now = new Date(2026, 8, 24, 23, 30); // late evening, local
const tasks = [
  task('yesterday', '2026-09-23T00:00:00Z'),
  task('today', '2026-09-24T00:00:00Z'),
  task('tomorrow', '2026-09-25T00:00:00Z'),
  task('none', null),
];

describe('groupToday', () => {
  it('splits overdue (first) from due-today and ignores later/undated', () => {
    const groups = groupToday(tasks, now);
    expect(groups.map((g) => [g.key, ids(g.tasks)])).toEqual([
      ['overdue', ['yesterday']],
      ['today', ['today']],
    ]);
  });

  it('omits the overdue group when nothing is overdue but always has Today', () => {
    expect(groupToday([task('tomorrow', '2026-09-25T00:00:00Z')], now)).toEqual([
      { key: 'today', label: 'Today', tasks: [] },
    ]);
  });
});

describe('upcomingFrom', () => {
  it('keeps today and later, drops overdue and undated', () => {
    expect(ids(upcomingFrom(tasks, now))).toEqual(['today', 'tomorrow']);
  });
});
