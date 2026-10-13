import { addDays, isBefore, isSameDay, startOfDay } from 'date-fns';
import { dueCalendarDate } from '@/lib/dateFormat';
import type { Task } from '@/domain/task';

/** Parse "HH:mm" (the <input type="time"> value). Falls back to `fallback`. */
export function parseTimeOfDay(value: string, fallback = '08:00'): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value) ?? /^(\d{1,2}):(\d{2})$/.exec(fallback)!;
  const h = Math.min(23, Number(match[1]));
  const m = Math.min(59, Number(match[2]));
  return { h, m };
}

function atTime(day: Date, time: string): Date {
  const { h, m } = parseTimeOfDay(time);
  const d = startOfDay(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Next moment strictly after `now` that matches `time` (and `weekday`, 0=Sunday,
 * when given). Used to hand summaries to the OS scheduler on mobile.
 */
export function nextFireAt(now: Date, time: string, weekday?: number): Date {
  let day = startOfDay(now);
  for (let i = 0; i < 8; i++) {
    const at = atTime(day, time);
    if (at.getTime() > now.getTime() && (weekday === undefined || at.getDay() === weekday)) {
      return at;
    }
    day = addDays(day, 1);
  }
  return atTime(addDays(startOfDay(now), 1), time); // unreachable for a valid weekday
}

/**
 * Whether a summary should fire right now (desktop polling): today matches the
 * weekday, the time has passed, we're still within `graceMs` of it (so opening
 * the app at 3pm doesn't deliver a "morning" summary), and it hasn't fired
 * today already.
 */
export function isSummaryDue(
  now: Date,
  time: string,
  lastFiredDay: string | null,
  dayKey: string,
  graceMs: number,
  weekday?: number,
): boolean {
  if (lastFiredDay === dayKey) return false;
  if (weekday !== undefined && now.getDay() !== weekday) return false;
  const at = atTime(now, time).getTime();
  const t = now.getTime();
  return t >= at && t - at <= graceMs;
}

export interface SummaryMessage {
  title: string;
  body: string;
}

interface Dated {
  title: string;
  dueDate: string | null;
  done: boolean;
}

function bucket(open: Dated[], now: Date): { overdue: Dated[]; today: Dated[] } {
  const today = startOfDay(now);
  const overdue: Dated[] = [];
  const due: Dated[] = [];
  for (const t of open) {
    if (t.done || !t.dueDate) continue;
    const d = dueCalendarDate(t.dueDate);
    if (isBefore(d, today)) overdue.push(t);
    else if (isSameDay(d, today)) due.push(t);
  }
  return { overdue, today: due };
}

/** Morning notification content for the day containing `now`. */
export function morningSummary(openTasks: Dated[], now: Date): SummaryMessage {
  const { overdue, today } = bucket(openTasks, now);
  if (today.length === 0 && overdue.length === 0) {
    return { title: 'Good morning', body: 'Nothing due today.' };
  }
  const parts: string[] = [];
  if (today.length) parts.push(`${today.length} due today`);
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  const first = today[0] ?? overdue[0];
  return {
    title: 'Today',
    body: `${parts.join(', ')}.${first ? ` Start with: ${first.title}` : ''}`,
  };
}

/** Weekly round-up content: last week's completions plus the week ahead. */
export function weeklyRoundup(openTasks: Dated[], doneLastWeek: number, now: Date): SummaryMessage {
  const { overdue } = bucket(openTasks, now);
  const today = startOfDay(now);
  const horizon = addDays(today, 7);
  let ahead = 0;
  for (const t of openTasks) {
    if (t.done || !t.dueDate) continue;
    const d = dueCalendarDate(t.dueDate);
    if (!isBefore(d, today) && isBefore(d, horizon)) ahead++;
  }
  const parts = [
    `${doneLastWeek} ${doneLastWeek === 1 ? 'task' : 'tasks'} done last week`,
    `${ahead} due in the next 7 days`,
  ];
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  return { title: 'Your week', body: `${parts.join(', ')}.` };
}

/** Due this many days out (or more) counts as "far" for suggestions. */
export const FAR_DUE_DAYS = 14;

/**
 * Tasks to offer when Today is empty: undated ones first (highest priority,
 * then oldest), then open tasks due far ahead, nearest first, as candidates to
 * bring forward. Pure, for tests.
 */
export function suggestTasks<T extends Pick<Task, 'dueDate' | 'done' | 'priority' | 'createdAt'>>(
  undated: T[],
  dated: T[],
  now: Date,
  limit = 3,
): T[] {
  const cutoff = addDays(startOfDay(now), FAR_DUE_DAYS);
  const noDate = undated
    .filter((t) => !t.done && !t.dueDate)
    .sort((a, b) => b.priority - a.priority || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const far = dated
    .filter((t) => !t.done && t.dueDate && !isBefore(dueCalendarDate(t.dueDate), cutoff))
    .sort((a, b) => dueCalendarDate(a.dueDate!).getTime() - dueCalendarDate(b.dueDate!).getTime());
  return [...noDate, ...far].slice(0, limit);
}
