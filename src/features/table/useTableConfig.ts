import { useCallback, useState } from 'react';
import type { Task } from '@/domain/task';

/**
 * Table view column config + multi-column sort.
 *
 * Mirrors Vikunja's table view: a flat `Record<ColumnKey, boolean>` for
 * visibility and a `Record<ColumnKey, 'asc'|'desc'>` for sort, both
 * persisted to *global* localStorage keys (`tableViewColumns` /
 * `tableViewSortBy`) — shared across every project, not scoped per view.
 *
 * `commentCount` (a Vikunja column) is omitted: comments aren't synced or
 * stored locally, so there's no count to show. `createdBy` has no local
 * users table, so it renders as "You" (current user) or `#id`.
 */
export type ColumnKey =
  | 'index'
  | 'done'
  | 'project'
  | 'title'
  | 'priority'
  | 'labels'
  | 'assignees'
  | 'dueDate'
  | 'startDate'
  | 'endDate'
  | 'percentDone'
  | 'updated'
  | 'created'
  | 'createdBy'
  | 'doneAt';

export type SortDir = 'asc' | 'desc';
export type SortState = Partial<Record<ColumnKey, SortDir>>;
export type VisibleState = Record<ColumnKey, boolean>;

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** Column header is clickable to cycle sort. Labels/assignees aren't. */
  sortable: boolean;
}

/** Render order is fixed (not user-reorderable), matching Vikunja. */
export const COLUMNS: readonly ColumnDef[] = [
  { key: 'index', label: '#', sortable: true },
  { key: 'done', label: 'Done', sortable: true },
  { key: 'project', label: 'Project', sortable: true },
  { key: 'title', label: 'Title', sortable: true },
  { key: 'priority', label: 'Priority', sortable: true },
  { key: 'labels', label: 'Labels', sortable: false },
  { key: 'assignees', label: 'Assignees', sortable: false },
  { key: 'dueDate', label: 'Due Date', sortable: true },
  { key: 'startDate', label: 'Start Date', sortable: true },
  { key: 'endDate', label: 'End Date', sortable: true },
  { key: 'percentDone', label: '% Done', sortable: true },
  { key: 'updated', label: 'Updated', sortable: true },
  { key: 'created', label: 'Created', sortable: true },
  { key: 'createdBy', label: 'Created By', sortable: true },
  { key: 'doneAt', label: 'Done At', sortable: true },
];

const SORTABLE = new Set<ColumnKey>(
  COLUMNS.filter((c) => c.sortable).map((c) => c.key),
);

/** Vikunja's `ACTIVE_COLUMNS_DEFAULT`. */
export const DEFAULT_VISIBLE: VisibleState = {
  index: true,
  done: true,
  project: false,
  title: true,
  priority: false,
  labels: true,
  assignees: true,
  dueDate: true,
  startDate: false,
  endDate: false,
  percentDone: false,
  updated: false,
  created: false,
  createdBy: false,
  doneAt: false,
};

/** Vikunja's default sort. */
export const DEFAULT_SORT: SortState = { index: 'desc' };

const COLUMNS_KEY = 'tableViewColumns';
const SORT_KEY = 'tableViewSortBy';

/* ───────────────────────── pure logic ───────────────────────── */

/**
 * Advance one column through the sort cycle: none → desc → asc → none.
 * `additive` (ctrl/meta-click) keeps the other sort columns and their
 * priority order; otherwise this column becomes the sole sort key.
 */
export function cycleSort(
  sortBy: SortState,
  key: ColumnKey,
  additive: boolean,
): SortState {
  const current = sortBy[key];
  const next: SortDir | undefined =
    current === undefined ? 'desc' : current === 'desc' ? 'asc' : undefined;

  if (!additive) {
    return next === undefined ? {} : { [key]: next };
  }

  // Rebuild preserving insertion order so changing a column's direction
  // doesn't bump its priority.
  const result: SortState = {};
  let found = false;
  for (const [k, v] of Object.entries(sortBy) as [ColumnKey, SortDir][]) {
    if (k === key) {
      found = true;
      if (next !== undefined) result[k] = next;
    } else {
      result[k] = v;
    }
  }
  if (!found && next !== undefined) result[key] = next;
  return result;
}

export interface SortContext {
  /** Resolve a project's display title from its local id. */
  projectTitle?: (projectLocalId: string) => string;
  /** Restrict the active sort to currently-visible columns (Vikunja
   * strips sort keys for hidden columns). Omit to sort by all keys. */
  visible?: Partial<VisibleState>;
}

/** Comparable value for a task in a given column. `null` sorts last. */
function sortValue(
  task: Task,
  key: ColumnKey,
  ctx: SortContext,
): number | string | null {
  switch (key) {
    case 'index':
      return task.serverId ?? null;
    case 'done':
      return task.done ? 1 : 0;
    case 'project':
      return (ctx.projectTitle?.(task.projectLocalId) ?? '').toLowerCase();
    case 'title':
      return task.title.toLowerCase();
    case 'priority':
      return task.priority;
    case 'percentDone':
      return task.percentDone;
    case 'dueDate':
      return task.dueDate ? Date.parse(task.dueDate) : null;
    case 'startDate':
      return task.startDate ? Date.parse(task.startDate) : null;
    case 'endDate':
      return task.endDate ? Date.parse(task.endDate) : null;
    case 'doneAt':
      return task.doneAt ? Date.parse(task.doneAt) : null;
    case 'updated':
      return task.updatedAt ? Date.parse(task.updatedAt) : null;
    case 'created':
      return task.createdAt ? Date.parse(task.createdAt) : null;
    case 'createdBy':
      return task.createdById;
    default:
      return null;
  }
}

function compareValues(
  a: number | string | null,
  b: number | string | null,
  dir: SortDir,
): number {
  // Nulls always sort last, regardless of direction.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = a < b ? -1 : a > b ? 1 : 0;
  return dir === 'asc' ? cmp : -cmp;
}

/**
 * Stable multi-column sort. Active sort keys are applied in priority
 * order; only sortable (and, if `ctx.visible` is given, visible) columns
 * participate. Returns a new array; the input is untouched.
 */
export function sortTasks(
  tasks: Task[],
  sortBy: SortState,
  ctx: SortContext = {},
): Task[] {
  const active = (Object.entries(sortBy) as [ColumnKey, SortDir][]).filter(
    ([k]) =>
      SORTABLE.has(k) && (ctx.visible ? ctx.visible[k] !== false : true),
  );
  if (active.length === 0) return [...tasks];

  return [...tasks].sort((ta, tb) => {
    for (const [key, dir] of active) {
      const c = compareValues(
        sortValue(ta, key, ctx),
        sortValue(tb, key, ctx),
        dir,
      );
      if (c !== 0) return c;
    }
    return 0;
  });
}

/* ───────────────────────── localStorage ───────────────────────── */

function loadVisible(): VisibleState {
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(COLUMNS_KEY)
        : null;
    if (raw) {
      // Merge over defaults so a column added in a later release shows up
      // with its default visibility rather than `undefined`.
      return { ...DEFAULT_VISIBLE, ...(JSON.parse(raw) as Partial<VisibleState>) };
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_VISIBLE };
}

function loadSort(): SortState {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(SORT_KEY) : null;
    if (raw) return JSON.parse(raw) as SortState;
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_SORT };
}

function persist(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    /* storage unavailable (e.g. private mode) — config just won't persist */
  }
}

export interface TableConfig {
  columns: readonly ColumnDef[];
  visible: VisibleState;
  sortBy: SortState;
  toggleColumn: (key: ColumnKey) => void;
  /** Cycle a column's sort. `additive` adds it as a secondary sort. */
  onSort: (key: ColumnKey, additive: boolean) => void;
}

export function useTableConfig(): TableConfig {
  const [visible, setVisible] = useState<VisibleState>(loadVisible);
  const [sortBy, setSortBy] = useState<SortState>(loadSort);

  const toggleColumn = useCallback((key: ColumnKey) => {
    setVisible((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      persist(COLUMNS_KEY, next);
      return next;
    });
  }, []);

  const onSort = useCallback((key: ColumnKey, additive: boolean) => {
    if (!SORTABLE.has(key)) return;
    setSortBy((prev) => {
      const next = cycleSort(prev, key, additive);
      persist(SORT_KEY, next);
      return next;
    });
  }, []);

  return { columns: COLUMNS, visible, sortBy, toggleColumn, onSort };
}
