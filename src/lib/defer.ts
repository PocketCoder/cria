import { addDays, isBefore, nextMonday, startOfDay } from 'date-fns';
import { dueCalendarDate } from './dateFormat';
import { pickDayIso } from '@/features/task-detail/taskDetailLogic';

export type DeferPreset = '1d' | '3d' | '1w' | 'nextMonday';

export const DEFER_PRESETS: { id: DeferPreset; label: string }[] = [
  { id: '1d', label: 'In 1 day' },
  { id: '3d', label: 'In 3 days' },
  { id: '1w', label: 'In 1 week' },
  { id: 'nextMonday', label: 'Next Monday' },
];

const DAYS: Record<Exclude<DeferPreset, 'nextMonday'>, number> = { '1d': 1, '3d': 3, '1w': 7 };

/**
 * The due date after deferring by `preset`. Interval presets count from the
 * later of the current due date and today, so deferring an overdue task always
 * lands in the future (no due date counts from today); a timed due date keeps
 * its time of day. "Next Monday" is always the Monday after
 * `now`, whatever the current due date. Reminders are left alone.
 */
export function deferDueIso(
  currentIso: string | null,
  preset: DeferPreset,
  now: Date = new Date(),
): string {
  let day: Date;
  if (preset === 'nextMonday') {
    day = nextMonday(startOfDay(now));
  } else {
    const today = startOfDay(now);
    const due = currentIso ? dueCalendarDate(currentIso) : today;
    day = addDays(isBefore(due, today) ? today : due, DAYS[preset]);
  }
  return pickDayIso(day, currentIso) as string;
}
