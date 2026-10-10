import { createTask } from '@/db/tasks';
import { applyLabelsByTitle } from '@/db/labels';
import { addReminder, type AddReminderInput } from '@/db/reminders';
import { findProjectByTitle } from '@/lib/quickAddProject';
import type { QuickAddResult } from '@/lib/quickAddParser';
import type { TaskInput } from '@/domain/task';
import type { Project } from '@/domain/project';

export interface QuickAddFields {
  description: string;
  dueDate: string | null;
  priority: number;
  repeatAfter: number | null;
  repeatMode: number | null;
}

/**
 * Whether the form can be submitted: it needs a title, and a project, unless a
 * `+project` token was typed (that is resolved at submit time).
 */
export function canSubmitQuickAdd(
  parsed: Pick<QuickAddResult, 'title' | 'projectTitle'>,
  projectId: string | null,
): boolean {
  if (!parsed.title) return false;
  if (!parsed.projectTitle && !projectId) return false;
  return true;
}

/**
 * Build the task input. The `+project` token is resolved here (not only via
 * the dropdown-syncing effect) so a type-then-Enter race can't route the task
 * to the wrong, previously-selected project.
 */
export function buildQuickAddInput(
  parsed: Pick<QuickAddResult, 'title' | 'projectTitle'>,
  projects: Pick<Project, 'localId' | 'title'>[],
  projectId: string | null,
  fields: QuickAddFields,
): TaskInput {
  const { description, dueDate, priority, repeatAfter, repeatMode } = fields;
  const matchedProject = parsed.projectTitle
    ? findProjectByTitle(projects, parsed.projectTitle)
    : undefined;
  return {
    title: parsed.title,
    // If a +project token was parsed but no matching project exists,
    // omit the projectLocalId so the task falls back to the Inbox.
    ...(matchedProject ? { projectLocalId: matchedProject.localId } : {}),
    // If there is no +project token, keep the currently selected project.
    ...(!parsed.projectTitle ? { projectLocalId: projectId } : {}),
    ...(description.trim() ? { description: description.trim() } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(priority > 0 ? { priority } : {}),
    ...(repeatAfter !== null ? { repeatAfter } : {}),
    ...(repeatMode !== null ? { repeatMode } : {}),
  };
}

/** Create the task, then apply labels and reminders (each best-effort). */
export async function persistQuickAdd(
  input: TaskInput,
  labelTitles: string[],
  reminders: AddReminderInput[],
  assigneeUsernames: string[],
): Promise<void> {
  const created = await createTask(input);

  // Apply chosen labels (picker + any typed *tokens) — create-if-missing.
  if (labelTitles.length > 0 && created.localId) {
    try {
      await applyLabelsByTitle(created.localId, labelTitles);
    } catch (err) {
      console.warn('[quick-add] label application failed:', err);
    }
  }

  // Persist create-time reminders (relative-to-due presets and/or an
  // absolute date+time). Relative reminders with no due date are parked
  // until one is set, matching the detail-view behaviour.
  if (reminders.length > 0 && created.localId) {
    for (const r of reminders) {
      try {
        await addReminder(created.localId, r);
      } catch (err) {
        console.warn('[quick-add] reminder add failed:', err);
      }
    }
  }

  // +assignee tokens are not yet applied (no local users table)
  if (assigneeUsernames.length > 0) {
    console.info(
      '[quick-add] +assignee tokens are parsed but not yet applied:',
      assigneeUsernames,
    );
  }
}

/** Union typed `*label` tokens into the picker's titles (case-insensitive, order kept). */
export function mergeLabelTitles(prev: string[], incoming: string[]): string[] {
  const lower = new Set(prev.map((t) => t.toLowerCase()));
  const merged = [...prev];
  for (const t of incoming) {
    if (!lower.has(t.toLowerCase())) merged.push(t);
  }
  return merged;
}

/**
 * A picker's value after the parsed token behind it changes from `before` to
 * `after` (null when the line has no such token). A parsed value is copied
 * in. When the parse stops producing one, because its token was deleted or
 * the line became a literal title, the value it put there is taken back out
 * (`empty`), unless the user has changed the picker since.
 */
export function followParsed<T>(
  current: T,
  before: T | null,
  after: T | null,
  empty: T,
  same: (a: T, b: T) => boolean = Object.is,
): T {
  if (after !== null) return after;
  if (before !== null && same(current, before)) return empty;
  return current;
}

/**
 * The label picker after the typed label tokens change from `before` to
 * `after`: labels whose token is gone leave the picker and new ones join it
 * (case-insensitive). Other picks stay, unless they match a removed token.
 */
export function followParsedLabels(current: string[], before: string[], after: string[]): string[] {
  const kept = new Set(after.map((t) => t.toLowerCase()));
  const gone = new Set(before.map((t) => t.toLowerCase()).filter((t) => !kept.has(t)));
  return mergeLabelTitles(
    current.filter((t) => !gone.has(t.toLowerCase())),
    after,
  );
}
