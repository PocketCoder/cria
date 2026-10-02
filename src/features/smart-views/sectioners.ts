import { format, startOfDay, isBefore, isSameDay, addDays } from 'date-fns';
import { toCalendarDate, dueDayKey } from '@/lib/dateFormat';
import type { TaskGroup } from '@/queries/smartViews';
import type { DisplayCtx } from '@/lib/displayConfig';
import type { TaskWithProject } from '@/db/tasks';

/** Today keeps its Overdue / Today / Completed split regardless of DisplayConfig. */
export function todaySectioner(visible: TaskWithProject[], ctx: DisplayCtx): TaskGroup[] {
  const overdue: TaskWithProject[] = [];
  const today: TaskWithProject[] = [];
  const completed: TaskWithProject[] = [];
  for (const t of visible) {
    if (t.done) completed.push(t);
    else if (t.dueDate && isBefore(startOfDay(toCalendarDate(t.dueDate)), ctx.today)) overdue.push(t);
    else today.push(t);
  }
  const out: TaskGroup[] = [];
  if (overdue.length) out.push({ key: 'overdue', label: 'Overdue', tasks: overdue });
  if (today.length) out.push({ key: 'today', label: 'Today', tasks: today });
  if (completed.length) out.push({ key: 'completed', label: 'Completed', tasks: completed });
  return out;
}

/**
 * Upcoming agenda: one group per calendar day from today through the later of
 * (today + 13 days) or the last task's day — empty days included, like Todoist.
 * The calendar strip in the header navigates within this range.
 */
export function upcomingDayLabel(d: Date, today: Date): string {
  const date = format(d, 'EEE d MMM');
  if (isSameDay(d, today)) return `Today · ${date}`;
  if (isSameDay(d, addDays(today, 1))) return `Tomorrow · ${date}`;
  return date;
}

/** Collapse a run of consecutive empty agenda days into one muted line. */
function emptyRunLabel(groups: TaskGroup[], start: number, end: number): string {
  const first = groups[start]!;
  const last = groups[end]!;
  const a = first.label;
  const b = last.label;
  if (start === end) return `${a} · nothing scheduled`;
  const dayA = a.replace(/^Today · |^Tomorrow · /, '');
  const dayB = b.replace(/^Today · |^Tomorrow · /, '');
  return `${dayA} – ${dayB} · nothing scheduled`;
}

export function upcomingSectioner(visible: TaskWithProject[], ctx: DisplayCtx): TaskGroup[] {
  // Bucket by the due date's calendar day (dueDayKey: timezone-correct for both
  // all-day and timed tasks). Day keys are yyyy-MM-dd, so string comparison is
  // a valid date comparison — no Date math needed for the range bounds.
  const todayKey = format(ctx.today, 'yyyy-MM-dd');
  const byDay = new Map<string, TaskWithProject[]>();
  let lastKey = todayKey;
  for (const t of visible) {
    if (!t.dueDate) continue;
    const key = dueDayKey(t.dueDate);
    if (key < todayKey) continue; // Upcoming starts today; overdue lives in Today
    const arr = byDay.get(key) ?? [];
    arr.push(t);
    byDay.set(key, arr);
    if (key > lastKey) lastKey = key;
  }
  // Show today through the later of (today + 13d) or the last task's day.
  const minEndKey = format(addDays(ctx.today, 13), 'yyyy-MM-dd');
  const endKey = lastKey > minEndKey ? lastKey : minEndKey;
  const groups: TaskGroup[] = [];
  for (let d = ctx.today; format(d, 'yyyy-MM-dd') <= endKey; d = addDays(d, 1)) {
    const key = format(d, 'yyyy-MM-dd');
    groups.push({ key, label: upcomingDayLabel(d, ctx.today), tasks: byDay.get(key) ?? [] });
  }
  // Collapse runs of consecutive empty days into a single muted line.
  const out: TaskGroup[] = [];
  let runStart = -1;
  const flush = (end: number) => {
    if (runStart === -1) return;
    out.push({
      key: `empty-${groups[runStart]!.key}-${groups[end]!.key}`,
      label: emptyRunLabel(groups, runStart, end),
      tasks: [],
    });
    runStart = -1;
  };
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    if (g.tasks.length === 0) {
      if (runStart === -1) runStart = i;
      continue;
    }
    flush(i - 1);
    out.push(g);
  }
  flush(groups.length - 1);
  return out;
}
