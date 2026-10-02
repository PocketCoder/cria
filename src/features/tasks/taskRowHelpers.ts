import { format, startOfDay, isBefore } from 'date-fns';
import { dueCalendarDate, hasTimeOfDay, formatTime } from '@/lib/dateFormat';
import { updateTask } from '@/db/tasks';
import { playCompletionSound } from '@/utils/sound';
import { impactComplete } from '@/utils/haptics';
import { isRepeating } from '@/lib/repeatLabel';
import type { Task } from '@/domain/task';

export function formatDue(iso: string): string {
  try {
    const base = format(dueCalendarDate(iso), 'd MMM');
    return hasTimeOfDay(iso) ? `${base}, ${formatTime(iso)}` : base;
  } catch {
    return iso;
  }
}

export function countChecklistItems(
  html: string | null | undefined,
): { checked: number; total: number } {
  if (!html) return { checked: 0, total: 0 };
  const inputs = html.match(/<input\s[^>]*?type="checkbox"[^>]*?>/gi) ?? [];
  let checked = 0;
  for (const input of inputs) {
    if (/\bchecked\s*[= >]/i.test(input)) checked++;
  }
  return { checked, total: inputs.length };
}

export function isOverdue(iso: string): boolean {
  try {
    return isBefore(dueCalendarDate(iso), startOfDay(new Date()));
  } catch {
    return false;
  }
}

/** Returns whether the update actually went through — callers with a
 * side effect chained to completion (e.g. the Now block dropping the
 * task) must check this rather than assuming success. */
export async function toggleTaskDone(task: Task): Promise<boolean> {
  const nowDone = !task.done;
  try {
    await updateTask(task.localId, { done: nowDone });
    if (nowDone) {
      playCompletionSound();
      impactComplete();
    }
    return true;
  } catch (err) {
    console.error('Failed to toggle task:', err);
    return false;
  }
}

/** How many row signals collapse into the `+n` popover. */
export function countSuppressedSignals(s: {
  labelCount: number;
  hasAttachments: boolean;
  checklistTotal: number;
  repeatAfter: number;
  repeatMode: number;
  percentDone: number;
  hexColor: string | null | undefined;
}): number {
  return (
    (s.labelCount > 0 ? 1 : 0) +
    (s.hasAttachments ? 1 : 0) +
    (s.checklistTotal > 0 ? 1 : 0) +
    (isRepeating(s.repeatAfter, s.repeatMode) ? 1 : 0) +
    (s.percentDone > 0 ? 1 : 0) +
    (s.hexColor ? 1 : 0)
  );
}
