import type { Task, TaskUpdate } from '@/domain/task';
import type { ColumnKey, SortState, VisibleState } from './useTableConfig';

export type DraftFields = Partial<
  Pick<TaskUpdate, 'title' | 'priority' | 'dueDate' | 'startDate' | 'endDate' | 'percentDone'>
>;

export const EDITABLE_COLUMNS = new Set<ColumnKey>([
  'title',
  'priority',
  'dueDate',
  'startDate',
  'endDate',
  'percentDone',
  'labels',
]);

/** Date columns and the task field each one reads. */
export const DATE_COLUMN_FIELD = {
  dueDate: 'dueDate',
  startDate: 'startDate',
  endDate: 'endDate',
  doneAt: 'doneAt',
  updated: 'updatedAt',
  created: 'createdAt',
} as const satisfies Partial<Record<ColumnKey, keyof Task>>;

/** ISO (midnight UTC) → `YYYY-MM-DD` for a native date input. */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → midnight-UTC ISO, or null when cleared. */
export function fromDateInputValue(v: string): string | null {
  return v ? `${v}T00:00:00.000Z` : null;
}

/** Clamp a percent-done input to 0–100; non-numbers become 0. */
export function clampPercent(valueAsNumber: number): number {
  return Number.isFinite(valueAsNumber) ? Math.max(0, Math.min(100, valueAsNumber)) : 0;
}

/**
 * A blank title would wipe the task's name — every other title-edit path
 * guards on trim(), so drop an empty title from the patch rather than persist
 * it. Other edited fields in the same draft still save.
 */
export function cleanDraft(patch: DraftFields): DraftFields {
  if (typeof patch.title === 'string' && patch.title.trim() === '') {
    const { title: _omit, ...rest } = patch;
    return rest;
  }
  return patch;
}

/** "Created by" cell text. */
export function createdByLabel(
  createdById: number | null | undefined,
  currentUserServerId: number | null,
): string {
  if (createdById == null) return '—';
  return createdById === currentUserServerId ? 'You' : `#${createdById}`;
}

/** "#" cell text: the identifier, else `#<serverId>`, else a dash. */
export function taskIndexLabel(task: Pick<Task, 'identifier' | 'serverId'>): string {
  return task.identifier || (task.serverId != null ? `#${task.serverId}` : '—');
}

/** 1-based sort priority per column, only meaningful with >1 active key. */
export function computeSortOrder(
  sortBy: SortState,
  visible: VisibleState,
): Map<ColumnKey, number> {
  const active = (Object.keys(sortBy) as ColumnKey[]).filter((k) => visible[k]);
  const m = new Map<ColumnKey, number>();
  if (active.length > 1) active.forEach((k, i) => m.set(k, i + 1));
  return m;
}

/** "3 tasks" / "1 task" / "Loading…" / "No tasks" header text. */
export function taskCountLabel(active: number, completed: number, isLoading: boolean): string {
  if (active === 0 && completed === 0) return isLoading ? 'Loading…' : 'No tasks';
  return `${active} task${active === 1 ? '' : 's'}`;
}
