import { useState, useMemo, useCallback, memo } from 'react';
import { format, startOfDay, isBefore, isSameDay, addDays } from 'date-fns';
import { toCalendarDate, hasTimeOfDay, formatTime, dueDayKey } from '@/lib/dateFormat';
import { Check, Trash2, Paperclip } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUi } from '@/stores/ui';
import { useQueryClient } from '@tanstack/react-query';
import { updateTask } from '@/db/tasks';
import { playCompletionSound } from '@/utils/sound';
import { useLabels } from '@/queries/labels';
import { useCurrentUser } from '@/queries/user';
import { priorityColor } from '@/components/ui/priority-select';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { useSwipeGesture, SWIPE_COMPLETE_THRESHOLD, SWIPE_DELETE_THRESHOLD } from '@/lib/useSwipeGesture';
import { useLongPress } from '@/lib/useLongPress';
import { PullToRefresh } from '@/components/PullToRefresh';
import { forceSync } from '@/sync/forceSync';
import { useIsMobile } from '@/lib/useIsMobile';
import { impactComplete, impactDeleted } from '@/utils/haptics';
import {
  useTodayTasks,
  useUpcomingTasks,
  useLabelTasks,
  useInboxTasks,
  useFavoriteTasks,
  type TaskGroup,
} from '@/queries/smartViews';
import { useDisplayCtx } from '@/queries/displayData';
import { useDisplay } from '@/stores/display';
import { UpcomingCalendar } from '@/features/smart-views/UpcomingCalendar';
import {
  applyDisplay,
  filterSortTasks,
  defaultConfigFor,
  type DisplayCtx,
  type ViewKey,
} from '@/lib/displayConfig';
import { TaskDetail } from '@/features/task-detail/TaskDetail';
import { LabelChips } from '@/features/tasks/LabelChips';
import { TaskHoverPreview } from '@/features/tasks/TaskHoverPreview';
import { useTaskLabels } from '@/queries/taskLabels';
import { useTasksWithAttachments } from '@/queries/attachments';
import type { TaskWithProject } from '@/db/tasks';

/* ─────────────────────────── shared chrome ─────────────────────────── */

/**
 * Generic smart-view scaffold: a title header, a scrollable list of
 * task groups (sticky sub-headers), inline create input, and the
 * floating detail card.  Today, Upcoming and Label views all render
 * through this — they only differ in how their groups are computed,
 * whether each row shows its project, and the default values the
 * create input pre-fills.
 */
function SmartView({
  title,
  viewKey: vKey,
  tasks,
  isLoading,
  emptyMessage,
  showProject,
  sectioner,
  headerSlot,
  keepEmptyGroups,
}: {
  title: string;
  viewKey: ViewKey;
  tasks: TaskWithProject[];
  isLoading: boolean;
  emptyMessage: string;
  showProject: boolean;
  /** Date-scoped views (Today) own their section layout; given the
   * filtered+sorted tasks they return the groups to render. When absent,
   * grouping comes from the DisplayConfig. */
  sectioner?: (visible: TaskWithProject[], ctx: DisplayCtx) => TaskGroup[];
  /** Rendered above the list (e.g. the Upcoming calendar strip). */
  headerSlot?: React.ReactNode;
  /** Keep empty groups (Upcoming shows every day, even ones with no tasks). */
  keepEmptyGroups?: boolean;
}) {
  const isMobile = useIsMobile();
  const pendingDeletes = usePendingDeletes((s) => s.pending);
  const ctx = useDisplayCtx();
  const stored = useDisplay((s) => s.configs[vKey]);
  const config = useMemo(() => stored ?? defaultConfigFor(vKey), [stored, vKey]);

  const liveTasks = useMemo(
    () => tasks.filter((t) => !pendingDeletes[t.localId]),
    [tasks, pendingDeletes],
  );

  const { groups: rawGroups } = useMemo(() => {
    if (sectioner) {
      const { visible } = filterSortTasks(liveTasks, ctx, config);
      return { groups: sectioner(visible, ctx) };
    }
    return { groups: applyDisplay(liveTasks, ctx, config).groups };
  }, [liveTasks, ctx, config, sectioner]);

  const filtered = keepEmptyGroups ? rawGroups : rawGroups.filter((g) => g.tasks.length > 0);
  const total = filtered.reduce((n, g) => n + g.tasks.length, 0);
  const activeTotal = filtered.reduce(
    (n, g) => n + g.tasks.filter((t) => !t.done).length,
    0,
  );

  // Task creation lives in the global quick-add (the + FAB / ⌘⇧A), not an
  // inline input — see Shell.
  const qc = useQueryClient();
  const handleRefresh = useCallback(async () => {
    // Pull-to-refresh must actually hit the server. The smart-view queries only
    // read the local DB, so invalidating alone re-reads unchanged data and
    // nothing appears to sync. forceSync drains the outbox + pulls every entity
    // and notifies the bus; the invalidate is belt-and-braces for any query not
    // covered by a bus topic.
    await forceSync();
    await qc.invalidateQueries();
  }, [qc]);

  return (
    <>
      {/* On mobile the title is shown by the app header (large title), so this
          in-content header would duplicate it — desktop only. */}
      {!isMobile && (
        <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-7 py-3">
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
          {activeTotal > 0 ? (
            <span className="text-xs text-[var(--color-muted-foreground)]">
              {activeTotal}
            </span>
          ) : null}
        </header>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* headerSlot (e.g. the Upcoming calendar) sits outside PullToRefresh
              so it stays pinned while the agenda below it scrolls. */}
          {headerSlot}
          <PullToRefresh onRefresh={handleRefresh}>
          {isLoading && total === 0 ? (
            <p className="p-6 text-sm text-[var(--color-muted-foreground)]">
              Loading…
            </p>
          ) : total === 0 && !keepEmptyGroups ? (
            <p className="p-6 text-sm text-[var(--color-muted-foreground)]">
              {emptyMessage}
            </p>
          ) : (
            filtered.map((g) => {
              const activeCount = g.tasks.filter((t) => !t.done).length;
              return (
                <div key={g.key} data-day={g.key}>
                  {g.label ? (
                    <h2 className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-background)] px-7 py-1.5 text-footnote font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                      {g.label}
                      {activeCount > 0 ? (
                        <span className="font-normal normal-case">{activeCount}</span>
                      ) : null}
                    </h2>
                  ) : null}
                  <ul>
                    {g.tasks.map((t) => (
                      <SmartTaskRow key={t.localId} task={t} showProject={showProject} />
                    ))}
                  </ul>
                </div>
              );
            })
          )}
          </PullToRefresh>
        </section>
        <TaskDetail />
      </div>
    </>
  );
}

export const SmartTaskRow = memo(function SmartTaskRow({
  task,
  showProject,
}: {
  task: TaskWithProject;
  showProject: boolean;
}) {
  const selectedTaskId = useUi((s) => s.selectedTaskLocalId);
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const enqueueDelete = usePendingDeletes((s) => s.enqueue);
  const selecting = useDisplay((s) => s.selecting);
  const isSelected = useDisplay((s) => !!s.selected[task.localId]);
  const toggleSelected = useDisplay((s) => s.toggleSelected);
  const openActions = useDisplay((s) => s.openActions);
  const longPress = useLongPress(() => openActions(task));
  const { data: labels = [] } = useTaskLabels(task.localId);
  const { data: attachmentIds } = useTasksWithAttachments();
  const hasAttachments = attachmentIds?.has(task.localId) ?? false;

  // Date formatting is the most expensive per-row work; memoize it so it
  // only recomputes when the due date itself changes, not on every render.
  const dueLabel = useMemo(
    () => (task.dueDate ? formatDue(task.dueDate) : null),
    [task.dueDate],
  );

  const handleToggle = useCallback(async () => {
    const nowDone = !task.done;
    try {
      await updateTask(task.localId, { done: nowDone });
      if (nowDone) {
        playCompletionSound();
        impactComplete();
      }
    } catch (err) {
      console.error('Failed to toggle task:', err);
    }
  }, [task.localId, task.done]);

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      enqueueDelete(task);
    },
    [enqueueDelete, task],
  );

  const handleSwipeComplete = useCallback(() => {
    void handleToggle();
  }, [handleToggle]);

  const handleSwipeDelete = useCallback(() => {
    enqueueDelete(task);
    impactDeleted();
  }, [enqueueDelete, task]);

  const { ref: swipeRef, isSwiping, swipeOffset } = useSwipeGesture<HTMLDivElement>({
    onComplete: handleSwipeComplete,
    onDelete: handleSwipeDelete,
  });

  const handleClick = () => {
    if (isSwiping || longPress.consumeLongPress()) return;
    if (selecting) toggleSelected(task.localId);
    else setSelectedTask(task.localId);
  };

  return (
    <li
      data-task-row=""
      onClick={handleClick}
      className={cn(
        'group flex cursor-pointer items-start gap-3 border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-accent)]/5',
        task.done && 'opacity-60',
        isSelected && 'bg-[var(--color-primary)]/10',
        !isSelected && selectedTaskId === task.localId && 'bg-[var(--color-accent)]/10',
      )}
      style={{ overflow: 'hidden', position: 'relative' }}
    >
      {/* Left-side progressive action indicator (left-to-right swipe) */}
      {(() => {
        const t = swipeOffset > 0
          ? Math.min(1, swipeOffset / SWIPE_DELETE_THRESHOLD)
          : 0;
        const blend = swipeOffset > SWIPE_COMPLETE_THRESHOLD
          ? Math.min(1, (swipeOffset - SWIPE_COMPLETE_THRESHOLD) / (SWIPE_DELETE_THRESHOLD - SWIPE_COMPLETE_THRESHOLD))
          : 0;
        const r = Math.round(22 + (239 - 22) * blend);
        const g = Math.round(163 - 163 * blend);
        const b = Math.round(74 - 74 * blend);
        const doneOpacity = swipeOffset > 0 ? (swipeOffset < SWIPE_COMPLETE_THRESHOLD ? 1 : Math.max(0, 1 - blend * 1.5)) : 0;
        const deleteOpacity = swipeOffset > SWIPE_COMPLETE_THRESHOLD ? Math.min(1, (blend - 0.2) / 0.8) : 0;
        return (
          <div
            className="absolute inset-y-0 left-0 flex items-center justify-center text-white text-xs font-medium pointer-events-none"
            style={{ zIndex: 0, width: `${Math.round(t * SWIPE_DELETE_THRESHOLD)}px` }}
          >
            <span style={{ background: t > 0 ? `rgb(${r} ${g} ${b})` : 'transparent', position: 'absolute', inset: 0 }} />
            <span className="absolute flex items-center gap-1" style={{ opacity: doneOpacity, transition: 'none' }}>
              <Check className="h-4 w-4" />
              Done
            </span>
            <span className="absolute flex items-center gap-1" style={{ opacity: deleteOpacity, transition: 'none' }}>
              <Trash2 className="h-4 w-4" />
              Delete
            </span>
          </div>
        );
      })()}


      <div
        ref={swipeRef as React.Ref<HTMLDivElement>}
        className="flex w-full items-start gap-3 px-7 py-3"
        style={{ position: 'relative', zIndex: 1, background: 'var(--color-card)' }}
        {...longPress.handlers}
      >
        {selecting ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleSelected(task.localId); }}
            aria-label={isSelected ? 'Deselect' : 'Select'}
            className={cn(
              'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border',
              isSelected
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                : 'border-[var(--color-muted-foreground)]',
            )}
          >
            {isSelected && <Check className="h-3 w-3" />}
          </button>
        ) : (
          <input
            type="checkbox"
            checked={task.done}
            onChange={handleToggle}
            onClick={(e) => e.stopPropagation()}
            aria-label={task.done ? 'Done' : 'Not done'}
            className="task-check mt-0.5"
          />
        )}
        <div className="min-w-0 flex-1">
          <TaskHoverPreview task={task}>
            <p
              className={cn(
                'truncate text-sm',
                task.done && 'text-[var(--color-muted-foreground)] line-through',
              )}
            >
              {task.title}
            </p>
          </TaskHoverPreview>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-[var(--color-muted-foreground)]">
            {showProject ? <span>{task.projectTitle}</span> : null}
            {dueLabel ? <span>{dueLabel}</span> : null}
            {task.priority > 0 ? (
              <span aria-label={`Priority ${task.priority}`} style={{ color: priorityColor(task.priority) }}>
                {'!'.repeat(Math.min(5, task.priority))}
              </span>
            ) : null}
            {hasAttachments ? (
              <Paperclip className="h-3 w-3" aria-label="Has attachments" />
            ) : null}
            <LabelChips labels={labels} />
          </div>
        </div>
        {task.hexColor ? (
          <span
            aria-hidden="true"
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
            style={{ background: task.hexColor }}
          />
        ) : null}
        <div className="mt-1 flex items-center gap-1">
          <button
            onClick={handleDelete}
            aria-label="Delete task"
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-warning)] cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
});

function formatDue(iso: string): string {
  try {
    const base = format(toCalendarDate(iso), 'd MMM');
    return hasTimeOfDay(iso) ? `${base}, ${formatTime(iso)}` : base;
  } catch {
    return iso;
  }
}

/* ───────────────────────────── view wrappers ───────────────────────── */

function flatten(groups: TaskGroup[]): TaskWithProject[] {
  return groups.flatMap((g) => g.tasks);
}

/** Today keeps its Overdue / Today split regardless of DisplayConfig. */
function todaySectioner(visible: TaskWithProject[], ctx: DisplayCtx): TaskGroup[] {
  const overdue: TaskWithProject[] = [];
  const today: TaskWithProject[] = [];
  for (const t of visible) {
    if (t.dueDate && isBefore(startOfDay(toCalendarDate(t.dueDate)), ctx.today)) overdue.push(t);
    else today.push(t);
  }
  const out: TaskGroup[] = [];
  if (overdue.length) out.push({ key: 'overdue', label: 'Overdue', tasks: overdue });
  out.push({ key: 'today', label: 'Today', tasks: today });
  return out;
}

/**
 * Upcoming agenda: one group per calendar day from today through the later of
 * (today + 13 days) or the last task's day — empty days included, like Todoist.
 * The calendar strip in the header navigates within this range.
 */
function upcomingDayLabel(d: Date, today: Date): string {
  const date = format(d, 'd MMM');
  if (isSameDay(d, today)) return `${date} · Today · ${format(d, 'EEEE')}`;
  if (isSameDay(d, addDays(today, 1))) return `${date} · Tomorrow · ${format(d, 'EEEE')}`;
  return `${date} · ${format(d, 'EEEE')}`;
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
  return groups;
}

export function TodayView() {
  const { data: groups = [], isLoading } = useTodayTasks();
  const tasks = useMemo(() => flatten(groups), [groups]);
  return (
    <SmartView
      title="Today"
      viewKey="today"
      tasks={tasks}
      isLoading={isLoading}
      emptyMessage="Nothing due today. 🎉"
      showProject
      sectioner={todaySectioner}
    />
  );
}

export function UpcomingView() {
  const { data: groups = [], isLoading } = useUpcomingTasks();
  const { data: user } = useCurrentUser();
  const tasks = useMemo(() => flatten(groups), [groups]);
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const today = useMemo(() => startOfDay(new Date()), []);

  const taskDays = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) {
      if (t.dueDate) s.add(dueDayKey(t.dueDate));
    }
    return s;
  }, [tasks]);

  const handlePickDay = useCallback((d: Date) => {
    setSelected(d);
    const key = format(d, 'yyyy-MM-dd');
    // The agenda renders a [data-day] container per day; scroll it into view.
    requestAnimationFrame(() => {
      document.querySelector(`[data-day="${key}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }, []);

  return (
    <SmartView
      title="Upcoming"
      viewKey="upcoming"
      tasks={tasks}
      isLoading={isLoading}
      emptyMessage="Nothing upcoming."
      showProject
      sectioner={upcomingSectioner}
      keepEmptyGroups
      headerSlot={
        <UpcomingCalendar
          taskDays={taskDays}
          today={today}
          selected={selected}
          onPickDay={handlePickDay}
          weekStartsOn={user?.weekStart ?? 1}
        />
      }
    />
  );
}

export function LabelView({ labelLocalId }: { labelLocalId: string }) {
  const { data: groups = [], isLoading } = useLabelTasks(labelLocalId);
  const { data: labels = [] } = useLabels();
  const tasks = useMemo(() => flatten(groups), [groups]);
  const title = labels.find((l) => l.localId === labelLocalId)?.title ?? 'Label';
  return (
    <SmartView
      title={`#${title}`}
      viewKey={`label:${labelLocalId}`}
      tasks={tasks}
      isLoading={isLoading}
      emptyMessage="No tasks with this label."
      showProject={false}
    />
  );
}

export function FavoritesView() {
  const { data: groups = [], isLoading } = useFavoriteTasks();
  const tasks = useMemo(() => flatten(groups), [groups]);
  return (
    <SmartView
      title="Favorites"
      viewKey="favorites"
      tasks={tasks}
      isLoading={isLoading}
      emptyMessage="No favorited tasks."
      showProject
    />
  );
}

export function InboxView() {
  const { data: groups = [], isLoading } = useInboxTasks();
  const tasks = useMemo(() => flatten(groups), [groups]);
  const title = groups[0]?.label ?? 'Inbox';
  return (
    <SmartView
      title={title}
      viewKey="inbox"
      tasks={tasks}
      isLoading={isLoading}
      emptyMessage="No inbox project set. Configure it in your Vikunja server settings."
      showProject={false}
    />
  );
}
