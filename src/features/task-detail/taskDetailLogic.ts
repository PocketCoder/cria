import { format } from 'date-fns';
import { formatRelativeReminder } from '@/lib/period';
import { dueCalendarDate, hasTimeOfDay, timedIso, type DateFormatters } from '@/lib/dateFormat';
import type { TaskReminder, ReminderRelation } from '@/db/reminders';
import type { Task } from '@/domain/task';

export type OpenSection = 'reminders' | 'attachments' | 'comments' | 'related' | 'repeat' | 'more' | null;

/** Which chip picker is open. Controlled so keyboard shortcuts (d/p/m/l/c) can
 * open the same popovers the chips open on click. */
export type Picker = 'due' | 'priority' | 'project' | 'label' | 'colour' | null;

/** The task's web URL on the server, or null when it has no server id / no server. */
export function taskWebUrl(
  task: Pick<Task, 'serverId'>,
  serverUrl: string | null | undefined,
): string | null {
  return task.serverId && serverUrl
    ? `${serverUrl.replace(/\/+$/, '')}/tasks/${task.serverId}`
    : null;
}

/**
 * Whether an Escape keydown should close the inspector. Not when something
 * else already consumed it (popovers, the lightbox and the editor's discard
 * prompt all preventDefault), nor while a modal sits above the inspector. The
 * mobile sheet is itself a `[role="dialog"]`, so `card` is exempt from the
 * modal check.
 */
export function escapeClosesInspector(e: KeyboardEvent, card: Element | null): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented) return false;
  const modals = document.querySelectorAll('[role="dialog"], dialog[open]');
  return !Array.from(modals).some((m) => m !== card);
}

/** Collapsing a section that is already open closes it. */
export function toggleSection(current: OpenSection, section: Exclude<OpenSection, null>): OpenSection {
  return current === section ? null : section;
}

/** Row value for counted sections: the count, or "None". */
export function countValue(n: number): string {
  return n > 0 ? `${n}` : 'None';
}

/** All-day date → midnight-UTC ISO (or null when cleared). */
export function utcMidnightIso(date: Date | undefined | null): string | null {
  return date
    ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString()
    : null;
}

/**
 * The ISO to store when a new day is picked for a task whose date is currently
 * `currentIso`. An all-day (or empty) date stays all-day; a timed one keeps its
 * local time-of-day on the new day, so re-picking the day never drops the time.
 */
export function pickDayIso(
  date: Date | undefined | null,
  currentIso: string | null | undefined,
): string | null {
  if (!date) return null;
  if (!currentIso || !hasTimeOfDay(currentIso)) return utcMidnightIso(date);
  const t = new Date(currentIso);
  return timedIso(new Date(date.getFullYear(), date.getMonth(), date.getDate(), t.getHours(), t.getMinutes(), 0, 0));
}

export function formatDueChip(iso: string): string {
  try {
    const base = format(dueCalendarDate(iso), 'EEE d MMM');
    return hasTimeOfDay(iso) ? `${base}, ${format(new Date(iso), 'HH:mm')}` : base;
  } catch {
    return iso;
  }
}

export function reminderSummary(reminders: TaskReminder[], fmt: DateFormatters): string {
  if (reminders.length === 0) return 'None';
  const r = reminders[0]!;
  if (r.relativePeriod != null && r.relativeTo) {
    return formatRelativeReminder(r.relativePeriod, r.relativeTo as ReminderRelation);
  }
  if (r.reminderAt) return fmt.formatDateTime(r.reminderAt);
  return 'Reminder';
}

export function taskRepeatLabel(task: Pick<Task, 'repeatAfter' | 'repeatMode'>): string {
  // Monthly mode ignores repeatAfter (often 0), so test the mode first.
  if (task.repeatMode === 1) return 'Monthly';
  if (task.repeatAfter <= 0) return 'Never';
  const s = task.repeatAfter;
  if (s >= 2592000 && s % 2592000 === 0) return `Every ${s / 2592000} month${s / 2592000 > 1 ? 's' : ''}`;
  if (s >= 86400 && s % 86400 === 0) return `Every ${s / 86400} day${s / 86400 > 1 ? 's' : ''}`;
  if (s >= 3600 && s % 3600 === 0) return `Every ${s / 3600} hour${s / 3600 > 1 ? 's' : ''}`;
  return `Every ${s}s`;
}

/** Relations other than subtask / parent links (those have their own UI). */
export function countRelated(relations: { kind: string }[]): number {
  return relations.filter((r) => r.kind !== 'subtask' && r.kind !== 'parenttask').length;
}
