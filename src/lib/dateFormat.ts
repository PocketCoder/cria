import { useMemo } from 'react';
import { format } from 'date-fns';
import { useSettings, type DateFormat, type TimeFormat } from '@/stores/settings';

/**
 * Preference-aware date/time formatting.
 *
 * The user's `dateFormat` preference is a numeric full-date pattern
 * (YYYY-MM-DD / MM/DD/YYYY / DD/MM/YYYY); `timeFormat` chooses 12h vs 24h.
 * These map to date-fns tokens below and drive every *full* date/time the
 * UI shows (reminders, conflict timestamps, the date-picker label). Dense
 * list rows deliberately keep their own compact "d MMM" style and don't go
 * through here.
 *
 * Timezone is intentionally not applied yet — dates render in the OS local
 * zone, same as before. Wiring the `timezone` preference (add a tz lib then)
 * is a separate follow-up.
 */

function dateToken(fmt: DateFormat): string {
  switch (fmt) {
    case 'MM/DD/YYYY':
      return 'MM/dd/yyyy';
    case 'DD/MM/YYYY':
      return 'dd/MM/yyyy';
    case 'YYYY-MM-DD':
    default:
      return 'yyyy-MM-dd';
  }
}

function timeToken(fmt: TimeFormat): string {
  return fmt === '12h' ? 'h:mm a' : 'HH:mm';
}

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Parse a UTC ISO date string back into a local-timezone Date whose calendar
 * components (year, month, day) match the UTC originals.
 *
 * Due dates are stored at midnight UTC (Vikunja's convention). A naive
 * `new Date(iso)` followed by `getDate()` / `format()` etc. interprets the
 * ISO instant in the OS timezone — west of UTC the date shifts back one day.
 * Calling `getUTC*()` preserves the intended calendar day.
 */
export function toCalendarDate(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * True when a due/date ISO carries a real time-of-day. All-day values are
 * stored at UTC midnight (the DatePicker convention); anything else is timed.
 * Lets list rows show the time only when one was actually set.
 */
export function hasTimeOfDay(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return !(d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0);
}

/**
 * The calendar-day key (yyyy-MM-dd) a due date belongs to, for day bucketing
 * (Upcoming agenda + calendar dots). All-day values (UTC midnight) use their
 * UTC day so they land on the day picked regardless of timezone; timed values
 * use the *local* day so "Friday 9am" shows on Friday. This keeps the agenda
 * and the calendar's local week-strip cells in lockstep.
 */
export function dueDayKey(iso: string): string {
  return format(hasTimeOfDay(iso) ? new Date(iso) : toCalendarDate(iso), 'yyyy-MM-dd');
}

export interface DateFormatters {
  /** Full numeric date per the user's `dateFormat` preference. */
  formatDate: (value: string | number | Date) => string;
  /** Full date + time, honouring `dateFormat` and `timeFormat`. */
  formatDateTime: (value: string | number | Date) => string;
  /** Time only, honouring `timeFormat`. */
  formatTime: (value: string | number | Date) => string;
}

function build(dateFormat: DateFormat, timeFormat: TimeFormat): DateFormatters {
  const dt = dateToken(dateFormat);
  const tt = timeToken(timeFormat);
  return {
    formatDate: (v) => format(toDate(v), dt),
    formatDateTime: (v) => format(toDate(v), `${dt}, ${tt}`),
    formatTime: (v) => format(toDate(v), tt),
  };
}

/**
 * Reactive formatters for use inside components — subscribes to the format
 * preferences so the view re-renders the moment the user changes them.
 */
export function useDateFormatter(): DateFormatters {
  const dateFormat = useSettings((s) => s.dateFormat);
  const timeFormat = useSettings((s) => s.timeFormat);
  return useMemo(() => build(dateFormat, timeFormat), [dateFormat, timeFormat]);
}

// Non-reactive variants for use outside React (data layer, plain helpers).
// They read the current preference at call time.
export const formatDate: DateFormatters['formatDate'] = (v) => {
  const s = useSettings.getState();
  return build(s.dateFormat, s.timeFormat).formatDate(v);
};
export const formatDateTime: DateFormatters['formatDateTime'] = (v) => {
  const s = useSettings.getState();
  return build(s.dateFormat, s.timeFormat).formatDateTime(v);
};
export const formatTime: DateFormatters['formatTime'] = (v) => {
  const s = useSettings.getState();
  return build(s.dateFormat, s.timeFormat).formatTime(v);
};
