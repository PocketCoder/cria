import { useState, useMemo, useCallback, memo } from 'react';
import { format, startOfDay, isBefore, isSameDay, addDays } from 'date-fns';
import { toCalendarDate, dueDayKey } from '@/lib/dateFormat';
import { Check, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useNow, useUi } from '@/stores/ui';
import { useIsMobile } from '@/lib/useIsMobile';
import { priorityColor } from '@/components/ui/priority-select';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/queries/user';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { useSwipeGesture, SWIPE_COMPLETE_THRESHOLD, SWIPE_DELETE_THRESHOLD } from '@/lib/useSwipeGesture';
import { useLongPress } from '@/lib/useLongPress';
import { PullToRefresh } from '@/components/PullToRefresh';
import { forceSync } from '@/sync/forceSync';
import { impactDeleted } from '@/utils/haptics';
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
import { useTaskLabels } from '@/queries/taskLabels';
import { useTasksWithAttachments } from '@/queries/attachments';
import {
  TaskRowCore,
  countChecklistItems,
  toggleTaskDone,
} from '@/features/tasks/TaskRowCore';
import { updateTask, type TaskWithProject } from '@/db/tasks';

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
  viewKey: vKey,
  tasks,
  isLoading,
  emptyMessage,
  showProject,
  sectioner,
  headerSlot,
  topSlot,
  keepEmptyGroups,
  agendaHeadings,
}: {
  viewKey: ViewKey;
  tasks: TaskWithProject[];
  isLoading: boolean;
  emptyMessage: string;
  showProject: boolean;
  /** Rendered inside the scroller, above the first group (e.g. the Now block). */
  topSlot?: React.ReactNode;
  /** Date-scoped views (Today) own their section layout; given the
   * filtered+sorted tasks they return the groups to render. When absent,
   * grouping comes from the DisplayConfig. */
  sectioner?: (visible: TaskWithProject[], ctx: DisplayCtx) => TaskGroup[];
  /** Rendered above the list (e.g. the Upcoming calendar strip). */
  headerSlot?: React.ReactNode;
  /** Keep empty groups (Upcoming shows every day, even ones with no tasks). */
  keepEmptyGroups?: boolean;
  /** Render group headings as real 16px/600 agenda headings separated by a
   * hairline, and empty-run groups as a single muted line. */
  agendaHeadings?: boolean;
}) {
  const pendingDeletes = usePendingDeletes((s) => s.pending);
  const ctx = useDisplayCtx();
  const stored = useDisplay((s) => s.configs[vKey]);
  const config = useMemo(() => stored ?? defaultConfigFor(vKey), [stored, vKey]);

  // Rows that just completed are kept rendered (from a snapshot) so the
  // collapse animation plays before the refetch moves them to a completed
  // group. Each entry remembers the group it belonged to.
  const [completing, setCompleting] = useState<
    Record<string, { task: TaskWithProject; groupKey: string }>
  >({});

  const handleRowToggle = useCallback((t: TaskWithProject, groupKey: string) => {
    if (t.done) {
      void toggleTaskDone(t);
      return;
    }
    setCompleting((prev) =>
      prev[t.localId] ? prev : { ...prev, [t.localId]: { task: t, groupKey } },
    );
    window.setTimeout(() => {
      setCompleting((prev) => {
        if (!prev[t.localId]) return prev;
        const next = { ...prev };
        delete next[t.localId];
        return next;
      });
    }, 650);
    void toggleTaskDone(t);
  }, []);

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
      <div className="flex min-h-0 min-w-0 flex-1">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* headerSlot (e.g. the Upcoming calendar) sits outside PullToRefresh
              so it stays pinned while the agenda below it scrolls. */}
          {headerSlot}
          <PullToRefresh onRefresh={handleRefresh}>
          {topSlot ? <div className="px-7 pt-4">{topSlot}</div> : null}
          {isLoading && total === 0 ? (
            <p className="p-6 text-sm text-[var(--color-muted-foreground)]">
              Loading…
            </p>
          ) : total === 0 && !keepEmptyGroups ? (
            emptyMessage ? (
              <p className="p-6 text-sm text-[var(--color-muted-foreground)]">
                {emptyMessage}
              </p>
            ) : null
          ) : (
            filtered.map((g) => {
              const activeCount = g.tasks.filter((t) => !t.done).length;
              const completingHere = Object.values(completing).filter(
                (c) => c.groupKey === g.key,
              );
              return (
                <div key={g.key} data-day={g.key}>
                  {g.tasks.length === 0 && agendaHeadings ? (
                    <p className="px-7 py-1.5 text-[13.5px] text-[var(--color-muted-foreground)]">
                      {g.label}
                    </p>
                  ) : g.label ? (
                    <h2
                      className={
                        agendaHeadings
                          ? 'border-t border-[var(--color-border)] px-7 pb-1 pt-2.5 text-base font-semibold text-[var(--color-foreground)]'
                          : cn(
                              'group-label px-7 py-1.5',
                              g.key === 'overdue'
                                ? 'text-[var(--color-destructive)]'
                                : 'text-[var(--color-muted-foreground)]',
                            )
                      }
                    >
                      {g.label}
                      {activeCount > 0 ? (
                        <span className="ml-2 text-xs font-normal normal-case text-[var(--color-muted-foreground)]">
                          {activeCount}
                        </span>
                      ) : null}
                    </h2>
                  ) : null}
                  <ul>
                    {g.tasks.map((t) => (
                      <SmartTaskRow
                        key={t.localId}
                        task={t}
                        showProject={showProject}
                        onToggle={() => handleRowToggle(t, g.key)}
                      />
                    ))}
                    {completingHere.map((c) => (
                      <SmartTaskRow
                        key={c.task.localId}
                        task={c.task}
                        showProject={showProject}
                        collapse
                      />
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
  onToggle,
  collapse,
}: {
  task: TaskWithProject;
  showProject: boolean;
  onToggle?: () => void;
  /** Renders the row collapsing away after a completion toggle. */
  collapse?: boolean;
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
  const checklist = useMemo(() => countChecklistItems(task.description), [task.description]);

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      enqueueDelete(task);
    },
    [enqueueDelete, task],
  );

  const handleSwipeComplete = useCallback(() => {
    if (onToggle) onToggle();
    else void toggleTaskDone(task);
  }, [onToggle, task]);

  const handleSwipeDelete = useCallback(() => {
    enqueueDelete(task);
    impactDeleted();
  }, [enqueueDelete, task]);

  const { ref: swipeRef, isSwiping, swipeOffset } = useSwipeGesture<HTMLDivElement>({
    onComplete: handleSwipeComplete,
    onDelete: handleSwipeDelete,
  });

  const handleClick = useCallback(() => {
    if (isSwiping || longPress.consumeLongPress()) return;
    if (selecting) toggleSelected(task.localId);
    else setSelectedTask(task.localId);
  }, [isSwiping, longPress, selecting, toggleSelected, task.localId, setSelectedTask]);

  const handleToggleSelect = useCallback(
    () => toggleSelected(task.localId),
    [toggleSelected, task.localId],
  );

  return (
    <li
      onClick={handleClick}
      className={cn(
        'border-b border-[var(--color-border)]',
        collapse && 'completion-collapse',
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
        className="w-full"
        style={{ position: 'relative', zIndex: 1, background: 'var(--color-card)' }}
        {...longPress.handlers}
      >
        <TaskRowCore
          task={task}
          labels={labels}
          hasAttachments={hasAttachments}
          checklist={checklist}
          projectTitle={showProject ? task.projectTitle : null}
          selecting={selecting}
          isSelected={isSelected}
          isOpen={!isSelected && selectedTaskId === task.localId}
          onToggle={onToggle}
          onToggleSelect={handleToggleSelect}
          className="px-7 py-3"
          actions={
            <div className="flex items-center gap-1">
              <button
                onClick={handleDelete}
                aria-label="Delete task"
                className="hover-reveal p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-warning)] cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          }
        />
      </div>
    </li>
  );
});

/* ───────────────────────────── view wrappers ───────────────────────── */

function flatten(groups: TaskGroup[]): TaskWithProject[] {
  return groups.flatMap((g) => g.tasks);
}

/** Today keeps its Overdue / Today / Completed split regardless of DisplayConfig. */
function todaySectioner(visible: TaskWithProject[], ctx: DisplayCtx): TaskGroup[] {
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
function upcomingDayLabel(d: Date, today: Date): string {
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

/* ─────────────────────────────── Now block ──────────────────────────── */

/** A stripped Now-block row: priority bar · checkbox · title(500) · project. */
function NowRow({ task }: { task: TaskWithProject }) {
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const unpick = useNow((s) => s.unpick);
  const handleToggle = useCallback(() => {
    void toggleTaskDone(task); // completing removes it from the block
    unpick(task.localId);
  }, [task, unpick]);
  return (
    <div
      onClick={() => setSelectedTask(task.localId)}
      className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-[9px] hover:bg-[var(--color-accent)]/5"
    >
      <span
        aria-hidden="true"
        className="h-5 w-[3px] shrink-0 rounded-full"
        style={{ background: task.priority > 2 ? priorityColor(task.priority) : 'transparent' }}
      />
      <input
        type="checkbox"
        checked={task.done}
        onChange={handleToggle}
        onClick={(e) => e.stopPropagation()}
        aria-label={task.done ? 'Done' : 'Not done'}
        className="task-check"
      />
      <p className="min-w-0 flex-1 truncate text-[14.5px] font-medium leading-snug">{task.title}</p>
      {task.projectTitle ? (
        <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">{task.projectTitle}</span>
      ) : null}
    </div>
  );
}

/**
 * A checklist sheet over a task list — used both to pick the Now block (max 3)
 * and to pull a future task forward. Selection is capped at `max`; `onConfirm`
 * receives the chosen ids.
 */
function PickerSheet({
  tasks,
  initialSelected = [],
  max = 3,
  title,
  subtitle,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  tasks: TaskWithProject[];
  initialSelected?: string[];
  max?: number;
  title: string;
  subtitle: string;
  confirmLabel: (n: number) => string;
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const [chosen, setChosen] = useState<string[]>(() =>
    initialSelected.filter((id) => tasks.some((t) => t.localId === id)),
  );

  const toggle = (id: string) => {
    setChosen((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= max ? prev : [...prev, id],
    );
  };
  const confirm = () => {
    onConfirm(chosen);
    onClose();
  };

  const header = (
    <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-[var(--color-foreground)]">{title}</h2>
        <p className="text-xs text-[var(--color-muted-foreground)]">{subtitle} · {chosen.length}/{max}</p>
      </div>
      <button
        onClick={onClose}
        aria-label="Close"
        className="rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );

  const body = (
    <>
      {tasks.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-[var(--color-muted-foreground)]">
          Nothing to pick from today.
        </p>
      ) : (
        <ul className="py-1">
          {tasks.map((t) => {
            const on = chosen.includes(t.localId);
            const full = !on && chosen.length >= max;
            return (
              <li key={t.localId}>
                <button
                  onClick={() => toggle(t.localId)}
                  disabled={full}
                  className={cn(
                    'flex w-full items-center gap-3 px-5 py-2.5 text-left disabled:opacity-40',
                    on && 'bg-[var(--color-accent)]/5',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border',
                      on
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                        : 'border-[var(--color-muted-foreground)]',
                    )}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                  {t.projectTitle ? (
                    <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">{t.projectTitle}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="border-t border-[var(--color-border)] px-5 py-3">
        <button
          onClick={confirm}
          className="w-full rounded-lg bg-[var(--color-inverse)] px-4 py-2.5 text-sm font-medium text-[var(--color-inverse-foreground)]"
        >
          {confirmLabel(chosen.length)}
        </button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-backdrop absolute inset-0" onClick={onClose} />
        <div className="safe-bottom relative z-10 flex max-h-[80vh] flex-col rounded-t-2xl bg-[var(--color-card)] shadow-xl animate-[sheet-up_350ms_var(--spring-snappy)] dark:border dark:border-[oklch(34%_0.008_265)]">
          {header}
          <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-[var(--color-card)] shadow-2xl dark:border dark:border-[oklch(34%_0.008_265)]"
        onClick={(e) => e.stopPropagation()}
      >
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      </div>
    </div>
  );
}

/**
 * The Now block: up to three user-picked tasks for today. Local device state
 * (`useNow`); a task leaves the block when it's completed or rescheduled off
 * today (both drop it out of `livePicks`). Renders its empty state when nothing
 * live is picked for today.
 */
function NowBlock({ tasks }: { tasks: TaskWithProject[] }) {
  const isMobile = useIsMobile();
  const { nowTaskIds, pickedOn, pick } = useNow();
  const [picking, setPicking] = useState(false);

  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const active = useMemo(() => tasks.filter((t) => !t.done), [tasks]);
  const livePicks = useMemo(() => {
    if (pickedOn !== todayKey) return [];
    const byId = new Map(active.map((t) => [t.localId, t]));
    return nowTaskIds.map((id) => byId.get(id)).filter(Boolean) as TaskWithProject[];
  }, [pickedOn, todayKey, nowTaskIds, active]);

  return (
    <div className={cn('mb-[34px] bg-[var(--color-background)] p-5', isMobile ? 'rounded-[18px]' : 'rounded-[14px]')}>
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 className="group-label !tracking-[0.11em] text-[var(--color-primary)]">Now</h2>
        <span className="text-xs text-[var(--color-muted-foreground)]">three things, then stop</span>
        {livePicks.length > 0 ? (
          <button
            onClick={() => setPicking(true)}
            className="ml-auto text-xs text-[var(--color-primary)]"
          >
            Re-pick
          </button>
        ) : null}
      </div>
      {livePicks.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {livePicks.map((t) => (
            <NowRow key={t.localId} task={t} />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--color-muted-foreground)]">Pick up to three things for today</span>
          <button
            onClick={() => setPicking(true)}
            className="shrink-0 rounded-lg bg-[var(--color-inverse)] px-3.5 py-2 text-xs font-medium text-[var(--color-inverse-foreground)]"
          >
            Pick
          </button>
        </div>
      )}
      {picking ? (
        <PickerSheet
          tasks={active}
          initialSelected={nowTaskIds}
          max={3}
          title="Pick for Now"
          subtitle="Up to three things, then stop"
          confirmLabel={(n) => (n ? `Pick ${n}` : 'Clear')}
          onConfirm={pick}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Today's empty state: no incomplete tasks left. Shows how many got done, the
 * next scheduled day, and a "Pull something forward" picker over the next
 * 7 days that reschedules the chosen tasks to today.
 */
function NothingDue({ doneCount }: { doneCount: number }) {
  const { data: groups = [] } = useUpcomingTasks();
  const [picking, setPicking] = useState(false);

  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const horizonKey = format(addDays(new Date(), 7), 'yyyy-MM-dd');
  const upcoming = useMemo(() => {
    const out: TaskWithProject[] = [];
    for (const t of groups.flatMap((g) => g.tasks)) {
      if (t.done || !t.dueDate) continue;
      const key = dueDayKey(t.dueDate);
      if (key > todayKey && key <= horizonKey) out.push(t);
    }
    return out.sort((a, b) => dueDayKey(a.dueDate!).localeCompare(dueDayKey(b.dueDate!)));
  }, [groups, todayKey, horizonKey]);

  const nextLine = useMemo(() => {
    if (upcoming.length === 0) return 'Nothing scheduled this week.';
    const done = doneCount > 0 ? `${doneCount} done. ` : '';
    return `${done}Next thing is ${upcomingDayLabel(toCalendarDate(upcoming[0]!.dueDate!), startOfDay(new Date())).replace(/ · .*/, '')}.`;
  }, [upcoming, doneCount]);

  const pullForward = useCallback((ids: string[]) => {
    const iso = new Date().toISOString();
    for (const id of ids) void updateTask(id, { dueDate: iso });
  }, []);

  return (
    <div className="mb-6 rounded-[14px] bg-[var(--color-background)] px-5 py-6 text-center">
      <p className="text-base font-medium">Nothing left today.</p>
      <p className="mt-1 text-[13.5px] text-[var(--color-muted-foreground)]">{nextLine}</p>
      {upcoming.length > 0 ? (
        <button
          onClick={() => setPicking(true)}
          className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2 text-[13px] font-medium"
        >
          Pull something forward
        </button>
      ) : null}
      {picking ? (
        <PickerSheet
          tasks={upcoming}
          max={upcoming.length}
          title="Pull forward"
          subtitle="Move to today"
          confirmLabel={(n) => (n ? `Pull ${n} forward` : 'Cancel')}
          onConfirm={pullForward}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </div>
  );
}

/** Today's header region: the Now block when there's work, else Nothing-due. */
function TodayTop({ tasks }: { tasks: TaskWithProject[] }) {
  const active = tasks.filter((t) => !t.done);
  if (active.length === 0) {
    return <NothingDue doneCount={tasks.filter((t) => t.done).length} />;
  }
  return <NowBlock tasks={tasks} />;
}

export function TodayView() {
  const { data: groups = [], isLoading } = useTodayTasks();
  const tasks = useMemo(() => flatten(groups), [groups]);
  return (
    <SmartView
      viewKey="today"
      tasks={tasks}
      isLoading={isLoading}
      emptyMessage=""
      showProject
      sectioner={todaySectioner}
      topSlot={<TodayTop tasks={tasks} />}
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
      viewKey="upcoming"
      tasks={tasks}
      isLoading={isLoading}
      emptyMessage="Nothing upcoming."
      showProject
      sectioner={upcomingSectioner}
      keepEmptyGroups
      agendaHeadings
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
  const tasks = useMemo(() => flatten(groups), [groups]);
  return (
    <SmartView
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
  return (
    <SmartView
      viewKey="inbox"
      tasks={tasks}
      isLoading={isLoading}
      emptyMessage="No inbox project set. Configure it in your Vikunja server settings."
      showProject={false}
    />
  );
}
