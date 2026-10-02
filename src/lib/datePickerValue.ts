import { toCalendarDate } from '@/lib/dateFormat';

const pad = (n: number) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;

/** Whole-calendar-day delta from today (local), ignoring time-of-day. */
function dayDelta(d: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cal = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((cal.getTime() - today.getTime()) / DAY_MS);
}

/** Relative label à la Todoist. */
export function smartLabel(d: Date, formatDate: (d: Date) => string): string {
  const diff = dayDelta(d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return formatDate(d);
}

/** Semantic colour for a set date: overdue red, today green, future accent. */
export function smartColor(d: Date): string {
  const diff = dayDelta(d);
  if (diff < 0) return 'var(--color-destructive)';
  if (diff === 0) return 'var(--color-success)';
  return 'var(--color-primary)';
}

/** Parse a stored ISO into the date + whether it carries a time-of-day.
   All-day values are stored as UTC midnight; anything else is "timed". */
export function parseValue(v: string | null): {
  date?: Date;
  hasTime: boolean;
  timeStr: string;
} {
  if (!v) return { hasTime: false, timeStr: '09:00' };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { hasTime: false, timeStr: '09:00' };
  const midnightUTC =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  return {
    date: d,
    hasTime: !midnightUTC,
    timeStr: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export interface PickerDisplay {
  display: string | null;
  selectedDate: Date | undefined;
  chipColor: string | undefined;
}

/** What the chip shows for a stored value (label, calendar selection, tint). */
export function describePickerValue(
  value: string | null,
  opts: { enableTime: boolean; smart: boolean; formatDate: (d: Date) => string },
): PickerDisplay {
  let display: string | null = null;
  let selectedDate: Date | undefined;
  let chipColor: string | undefined;
  if (value) {
    const parsed = parseValue(value);
    try {
      const cal = toCalendarDate(value);
      selectedDate = parsed.hasTime ? parsed.date ?? cal : cal;
      display = opts.smart
        ? smartLabel(selectedDate, opts.formatDate)
        : opts.formatDate(cal);
      if (opts.smart) chipColor = smartColor(selectedDate);
      if (opts.enableTime && parsed.hasTime) display = `${display} · ${parsed.timeStr}`;
    } catch {
      display = value;
    }
  }
  return { display, selectedDate, chipColor };
}

/**
 * The ISO to emit for a (date, all-day, time) triple. All-day (or time
 * disabled) → UTC midnight; timed → local datetime. No date → null.
 */
export function toPickerIso(
  d: Date | undefined,
  allDay: boolean,
  time: string,
  enableTime: boolean,
): string | null {
  if (!d) return null;
  if (allDay || !enableTime) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
  }
  const [hh, mm] = time.split(':').map((n) => Number(n) || 0);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0).toISOString();
}
