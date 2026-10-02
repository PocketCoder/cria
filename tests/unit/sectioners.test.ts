import { describe, expect, it } from 'vitest';
import {
  todaySectioner,
  upcomingDayLabel,
  upcomingSectioner,
} from '@/features/smart-views/sectioners';
import type { DisplayCtx } from '@/lib/displayConfig';
import type { TaskWithProject } from '@/db/tasks';

const today = new Date(2030, 4, 15); // local midnight, Wed 15 May 2030
const ctx = { today } as unknown as DisplayCtx;
const task = (localId: string, dueDate: string | null, done = false) =>
  ({ localId, dueDate, done }) as unknown as TaskWithProject;
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString();

describe('todaySectioner', () => {
  it('splits overdue, today and completed in that order', () => {
    const groups = todaySectioner(
      [
        task('done', null, true),
        task('late', iso(2030, 4, 10)),
        task('now', iso(2030, 4, 15)),
        task('nodate', null),
      ],
      ctx,
    );
    expect(groups.map((g) => [g.key, g.tasks.map((t) => t.localId)])).toEqual([
      ['overdue', ['late']],
      ['today', ['now', 'nodate']],
      ['completed', ['done']],
    ]);
  });
  it('omits empty groups', () => {
    expect(todaySectioner([], ctx)).toEqual([]);
  });
});

describe('upcomingDayLabel', () => {
  it('labels today, tomorrow and later days', () => {
    expect(upcomingDayLabel(today, today)).toBe('Today · Wed 15 May');
    expect(upcomingDayLabel(new Date(2030, 4, 16), today)).toBe('Tomorrow · Thu 16 May');
    expect(upcomingDayLabel(new Date(2030, 4, 20), today)).toBe('Mon 20 May');
  });
});

describe('upcomingSectioner', () => {
  it('covers 14 days from today and collapses empty runs', () => {
    const groups = upcomingSectioner([task('a', iso(2030, 4, 17))], ctx);
    expect(groups.map((g) => g.key)).toEqual([
      'empty-2030-05-15-2030-05-16',
      '2030-05-17',
      'empty-2030-05-18-2030-05-28',
    ]);
    expect(groups[1]!.tasks.map((t) => t.localId)).toEqual(['a']);
    expect(groups[2]!.label).toBe('Nothing else scheduled');
  });

  it('skips undated and past tasks and extends past 13 days for later tasks', () => {
    const groups = upcomingSectioner(
      [task('past', iso(2030, 4, 1)), task('none', null), task('far', iso(2030, 5, 5))],
      ctx,
    );
    const all = groups.flatMap((g) => g.tasks.map((t) => t.localId));
    expect(all).toEqual(['far']);
    expect(groups[groups.length - 1]!.key).toBe('2030-06-05');
  });

  it('labels a single empty day without a range', () => {
    const groups = upcomingSectioner(
      [task('a', iso(2030, 4, 15)), task('b', iso(2030, 4, 17)), task('c', iso(2030, 4, 30))],
      ctx,
    );
    const single = groups.find((g) => g.key === 'empty-2030-05-16-2030-05-16');
    expect(single?.label).toMatch(/nothing scheduled$/);
  });
});
