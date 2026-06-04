import type { Task } from '@/domain/task';

/**
 * Client-side board filter. The kanban loads all of a project's tasks
 * locally, so filtering is a pure predicate over the in-memory set rather
 * than a server query. Kept pure (no React) so it's unit-tested directly.
 */
export interface BoardFilter {
  /** Case-insensitive substring over title + description. */
  text: string;
  /** Minimum priority; 0 = any. */
  minPriority: number;
  /** Match tasks having ANY of these label local ids; empty = no constraint. */
  labelLocalIds: string[];
  /** When false, done tasks are hidden entirely. */
  showDone: boolean;
}

export const EMPTY_BOARD_FILTER: BoardFilter = {
  text: '',
  minPriority: 0,
  labelLocalIds: [],
  showDone: true,
};

/** Whether the filter would exclude anything (drives the "active" indicator). */
export function isBoardFilterActive(f: BoardFilter): boolean {
  return (
    f.text.trim() !== '' ||
    f.minPriority > 0 ||
    f.labelLocalIds.length > 0 ||
    !f.showDone
  );
}

/**
 * `taskLabelIds` is the task's label local ids (from the project's
 * task→labels map); pass `[]` when none.
 */
export function taskMatchesBoardFilter(
  task: Task,
  f: BoardFilter,
  taskLabelIds: string[],
): boolean {
  if (!f.showDone && task.done) return false;
  if (f.minPriority > 0 && task.priority < f.minPriority) return false;

  const term = f.text.trim().toLowerCase();
  if (term) {
    const hay = `${task.title} ${task.description ?? ''}`.toLowerCase();
    if (!hay.includes(term)) return false;
  }

  if (f.labelLocalIds.length > 0) {
    if (!taskLabelIds.some((id) => f.labelLocalIds.includes(id))) return false;
  }

  return true;
}

/* ── per-view persistence (localStorage) ── */

const STORAGE_KEY = 'cria:kanbanFilter';

export function loadBoardFilter(viewLocalId: string): BoardFilter {
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(`${STORAGE_KEY}:${viewLocalId}`)
        : null;
    if (raw) return { ...EMPTY_BOARD_FILTER, ...(JSON.parse(raw) as Partial<BoardFilter>) };
  } catch {
    /* ignore */
  }
  return EMPTY_BOARD_FILTER;
}

export function saveBoardFilter(viewLocalId: string, f: BoardFilter): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const k = `${STORAGE_KEY}:${viewLocalId}`;
    if (isBoardFilterActive(f)) localStorage.setItem(k, JSON.stringify(f));
    else localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}
