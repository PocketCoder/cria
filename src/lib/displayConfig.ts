import { startOfDay, isBefore, isSameDay, addDays, format } from 'date-fns';
import { toCalendarDate } from '@/lib/dateFormat';
import type { TaskWithProject } from '@/db/tasks';
import type { ActiveView } from '@/stores/ui';
import type { TaskGroup } from '@/queries/smartViews';

/* ── config model ─────────────────────────────────────────────────────── */

export type GroupBy = 'none' | 'project' | 'priority' | 'dueDate' | 'label';
/** `'all'` = no constraint, `'none'` = field is unset on the task. */
export type DateFilter = 'all' | 'overdue' | 'today' | 'week' | 'none';
export type AssigneeFilter = 'all' | 'me' | 'unassigned';

export type SortField =
  | 'smart'
  | 'manual'
  | 'dueDate'
  | 'endDate'
  | 'priority'
  | 'title'
  | 'created';
export interface DisplaySort {
  field: SortField;
  direction: 'asc' | 'desc';
}

export interface DisplayFilters {
  priority?: number[];
  dueDate?: DateFilter;
  deadline?: DateFilter; // endDate
  labels?: string[]; // label titles
  projects?: string[]; // project titles
  assignee?: AssigneeFilter;
}

export interface DisplayConfig {
  showCompleted: boolean;
  groupBy: GroupBy;
  sort: DisplaySort;
  filters: DisplayFilters;
}

/* ── per-view defaults ────────────────────────────────────────────────── */

export type ViewKey =
  | 'inbox'
  | 'today'
  | 'upcoming'
  | 'favorites'
  | `project:${string}`
  | `label:${string}`;

/** Stable key the Display store persists each view's config under. Views the
 * sheet doesn't apply to (search) return null. */
export function viewKey(view: ActiveView | null): ViewKey | null {
  if (!view) return null;
  switch (view.kind) {
    case 'inbox':
    case 'today':
    case 'upcoming':
    case 'favorites':
      return view.kind;
    case 'project':
      return `project:${view.localId}`;
    case 'label':
      return `label:${view.localId}`;
    default:
      return null;
  }
}

export function defaultConfigFor(key: ViewKey): DisplayConfig {
  const base: DisplayConfig = {
    showCompleted: false,
    groupBy: 'none',
    sort: { field: 'smart', direction: 'asc' },
    filters: {},
  };
  if (key.startsWith('label:') || key === 'favorites') {
    return { ...base, groupBy: 'project' };
  }
  // Projects default to manual order (matches Todoist's "Sorting: Manual"),
  // which keeps drag-to-reorder as the source of truth.
  if (key.startsWith('project:')) {
    return { ...base, sort: { field: 'manual', direction: 'asc' } };
  }
  return base;
}

/** Which sections the Display sheet renders for a view — mirrors the
 * Todoist screenshots (date views hide Grouping/Project, etc.). */
export interface DisplaySections {
  grouping: boolean;
  sorting: boolean;
  filters: {
    date: boolean;
    deadline: boolean;
    priority: boolean;
    label: boolean;
    project: boolean;
    assignee: boolean;
  };
}

export function sectionsFor(key: ViewKey): DisplaySections {
  const allFilters = {
    date: true,
    deadline: true,
    priority: true,
    label: true,
    project: true,
    assignee: true,
  };
  if (key === 'today') {
    return { grouping: false, sorting: true, filters: { ...allFilters, date: false } };
  }
  if (key === 'upcoming') {
    return { grouping: false, sorting: true, filters: { ...allFilters, date: false } };
  }
  if (key.startsWith('project:')) {
    // Grouping + layout for projects stay with the existing per-project view
    // switcher (List/Board/Table/Gantt); the sheet drives sort + filters.
    // Project filter is hidden — you're already inside one project.
    return { grouping: false, sorting: true, filters: { ...allFilters, project: false } };
  }
  if (key === 'inbox') {
    return { grouping: true, sorting: true, filters: { ...allFilters, project: false } };
  }
  // label / favorites
  return { grouping: true, sorting: true, filters: { ...allFilters, assignee: false } };
}

/* ── the transform ────────────────────────────────────────────────────── */

export interface DisplayCtx {
  /** task localId → label localIds */
  labelsByTask: Map<string, string[]>;
  /** label localId → title (for label filter + grouping) */
  labelTitleById: Map<string, string>;
  /** task localId → assignee user server ids */
  assigneesByTask: Map<string, number[]>;
  currentUserId: number | null;
  /** start-of-today; passed in so callers control the clock (and tests pin it) */
  today: Date;
}

/** The subset of task fields the filter/sort engine touches. `Task` and
 * `TaskWithProject` both satisfy it (projectTitle is only read when a project
 * filter/grouping is active, which never happens inside a single project). */
export interface DisplayTaskFields {
  localId: string;
  priority: number;
  dueDate: string | null;
  endDate: string | null;
  done: boolean;
  title: string;
  position: number | null;
  createdAt: string | null;
  projectTitle?: string;
}

function matchesDateFilter(iso: string | null, filter: DateFilter | undefined, today: Date): boolean {
  if (!filter || filter === 'all') return true;
  if (filter === 'none') return !iso;
  if (!iso) return false;
  const d = startOfDay(toCalendarDate(iso));
  if (filter === 'overdue') return isBefore(d, today);
  if (filter === 'today') return isSameDay(d, today);
  if (filter === 'week') return !isBefore(d, today) && isBefore(d, addDays(today, 7));
  return true;
}

function passesFilters(t: DisplayTaskFields, ctx: DisplayCtx, f: DisplayFilters): boolean {
  if (f.priority?.length && !f.priority.includes(t.priority)) return false;
  if (!matchesDateFilter(t.dueDate, f.dueDate, ctx.today)) return false;
  if (!matchesDateFilter(t.endDate, f.deadline, ctx.today)) return false;
  if (f.projects?.length && !f.projects.includes(t.projectTitle ?? '')) return false;
  if (f.labels?.length) {
    const titles = (ctx.labelsByTask.get(t.localId) ?? []).map(
      (id) => ctx.labelTitleById.get(id) ?? '',
    );
    if (!f.labels.some((l) => titles.includes(l))) return false;
  }
  if (f.assignee && f.assignee !== 'all') {
    const ids = ctx.assigneesByTask.get(t.localId) ?? [];
    if (f.assignee === 'unassigned' && ids.length > 0) return false;
    if (f.assignee === 'me' && !(ctx.currentUserId != null && ids.includes(ctx.currentUserId))) {
      return false;
    }
  }
  return true;
}

function compareTasks(a: DisplayTaskFields, b: DisplayTaskFields, sort: DisplaySort): number {
  const dir = sort.direction === 'desc' ? -1 : 1;
  const byDate = (x: string | null, y: string | null) => {
    if (!x && !y) return 0;
    if (!x) return 1; // nulls last regardless of direction
    if (!y) return -1;
    return (toCalendarDate(x).getTime() - toCalendarDate(y).getTime()) * dir;
  };
  switch (sort.field) {
    case 'manual':
      return ((a.position ?? Infinity) - (b.position ?? Infinity)) * dir;
    case 'title':
      return a.title.localeCompare(b.title) * dir;
    case 'priority':
      return (a.priority - b.priority) * dir;
    case 'dueDate':
      return byDate(a.dueDate, b.dueDate);
    case 'endDate':
      return byDate(a.endDate, b.endDate);
    case 'created':
      return byDate(a.createdAt, b.createdAt);
    case 'smart':
    default:
      // Todoist "smart": earliest due first (nulls last), then highest priority,
      // then title — a stable, sensible default for any list.
      return (
        byDate(a.dueDate, b.dueDate) ||
        b.priority - a.priority ||
        a.title.localeCompare(b.title)
      );
  }
}

const PRIORITY_GROUP_LABEL: Record<number, string> = {
  5: 'Priority 1',
  4: 'Priority 2',
  3: 'Priority 3',
  2: 'Priority 4',
  1: 'Priority 5',
  0: 'No priority',
};

function groupKey(t: TaskWithProject, ctx: DisplayCtx, groupBy: GroupBy): { key: string; label: string }[] {
  switch (groupBy) {
    case 'project':
      return [{ key: t.projectTitle, label: t.projectTitle }];
    case 'priority':
      return [{ key: `p${t.priority}`, label: PRIORITY_GROUP_LABEL[t.priority] ?? 'No priority' }];
    case 'dueDate': {
      if (!t.dueDate) return [{ key: 'zzz-none', label: 'No date' }];
      const d = startOfDay(toCalendarDate(t.dueDate));
      if (isBefore(d, ctx.today)) return [{ key: '000-overdue', label: 'Overdue' }];
      if (isSameDay(d, ctx.today)) return [{ key: '001-today', label: 'Today' }];
      if (isSameDay(d, addDays(ctx.today, 1))) return [{ key: '002-tomorrow', label: 'Tomorrow' }];
      return [{ key: format(d, 'yyyy-MM-dd'), label: format(d, 'EEEE d MMM') }];
    }
    case 'label': {
      const ids = ctx.labelsByTask.get(t.localId) ?? [];
      if (ids.length === 0) return [{ key: 'zzz-nolabel', label: 'No label' }];
      // A task appears under each of its labels (matches Todoist).
      return ids.map((id) => {
        const title = ctx.labelTitleById.get(id) ?? 'Label';
        return { key: `l:${title}`, label: title };
      });
    }
    case 'none':
    default:
      return [{ key: '_all', label: '' }];
  }
}

/** Filter an arbitrary task list (Task or TaskWithProject) by DisplayFilters. */
export function filterTasks<T extends DisplayTaskFields>(
  tasks: T[],
  ctx: DisplayCtx,
  filters: DisplayFilters,
): T[] {
  return tasks.filter((t) => passesFilters(t, ctx, filters));
}

/** Sort an arbitrary task list by a DisplaySort (returns a new array). */
export function sortTasks<T extends DisplayTaskFields>(tasks: T[], sort: DisplaySort): T[] {
  return [...tasks].sort((a, b) => compareTasks(a, b, sort));
}

export interface FilterSortResult {
  /** filtered + sorted tasks (completed included only when showCompleted) */
  visible: TaskWithProject[];
  /** done tasks that passed the (non-completed) filters — drives the toggle's count */
  completedCount: number;
}

/**
 * Filter (by config.filters + showCompleted) then sort — no grouping. Date-scoped
 * views (Today) own their own section layout but still need the config's filter/
 * sort/completed pass applied first.
 */
export function filterSortTasks(
  tasks: TaskWithProject[],
  ctx: DisplayCtx,
  config: DisplayConfig,
): FilterSortResult {
  const matched = tasks.filter((t) => passesFilters(t, ctx, config.filters));
  const completedCount = matched.filter((t) => t.done).length;
  const visible = (config.showCompleted ? matched : matched.filter((t) => !t.done)).sort(
    (a, b) => compareTasks(a, b, config.sort),
  );
  return { visible, completedCount };
}

export interface DisplayResult {
  groups: TaskGroup[];
  completedCount: number;
}

/**
 * Pure filter → sort → group over an in-memory task list, driven by a
 * DisplayConfig. Used by every smart view and the project List layout so there
 * is exactly one filter/sort/group engine. `showCompleted=false` removes done
 * tasks from the groups but still reports how many matched.
 */
export function applyDisplay(
  tasks: TaskWithProject[],
  ctx: DisplayCtx,
  config: DisplayConfig,
): DisplayResult {
  const { visible: sorted, completedCount } = filterSortTasks(tasks, ctx, config);

  const order: string[] = [];
  const buckets = new Map<string, TaskGroup>();
  for (const t of sorted) {
    for (const { key, label } of groupKey(t, ctx, config.groupBy)) {
      let g = buckets.get(key);
      if (!g) {
        g = { key, label, tasks: [] };
        buckets.set(key, g);
        order.push(key);
      }
      g.tasks.push(t);
    }
  }
  // Stable, human order: explicit dueDate sections sort by their numeric prefix;
  // everything else keeps first-seen (already sorted) order.
  const groups =
    config.groupBy === 'dueDate'
      ? order.sort().map((k) => buckets.get(k)!)
      : order.map((k) => buckets.get(k)!);

  return { groups, completedCount };
}
