import { useState, useRef, useMemo, useCallback, memo } from 'react';
import { format } from 'date-fns';
import { toCalendarDate } from '@/lib/dateFormat';
import { Check, Plus, Loader2, Trash2, Paperclip, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DatePicker } from '@/components/DatePicker';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useUi } from '@/stores/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createTask, updateTask } from '@/db/tasks';
import { playCompletionSound } from '@/utils/sound';
import { applyLabelsByTitle, toggleTaskLabel } from '@/db/labels';
import { useLabels } from '@/queries/labels';
import { useProjects } from '@/queries/projects';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { useSwipeGesture, SWIPE_COMPLETE_THRESHOLD, SWIPE_DELETE_THRESHOLD } from '@/lib/useSwipeGesture';
import { PullToRefresh } from '@/components/PullToRefresh';
import { useIsMobile } from '@/lib/useIsMobile';
import { impactComplete, impactDeleted } from '@/utils/haptics';
import {
  useTodayTasks,
  useUpcomingTasks,
  useLabelTasks,
  useInboxTasks,
  useFavoriteTasks,
  groupTotal,
  type TaskGroup,
} from '@/queries/smartViews';
import { TaskDetail } from '@/features/task-detail/TaskDetail';
import { QuickAddPreview } from '@/features/tasks/QuickAddPreview';
import { LabelChips } from '@/features/tasks/LabelChips';
import { TaskHoverPreview } from '@/features/tasks/TaskHoverPreview';
import { useTaskLabels } from '@/queries/taskLabels';
import { useTasksWithAttachments } from '@/queries/attachments';
import { parseQuickAdd } from '@/lib/quickAddParser';
import type { TaskWithProject } from '@/db/tasks';
import type { TaskInput } from '@/domain/task';

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
  groups,
  isLoading,
  emptyMessage,
  showProject,
  defaultDueDate,
  defaultLabelLocalId,
}: {
  title: string;
  groups: TaskGroup[];
  isLoading: boolean;
  emptyMessage: string;
  showProject: boolean;
  defaultDueDate?: string;
  defaultLabelLocalId?: string;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const isMobile = useIsMobile();
  const pendingDeletes = usePendingDeletes((s) => s.pending);
  const filtered = groups
    .map((g) => ({
      ...g,
      tasks: g.tasks.filter((t) => !pendingDeletes[t.localId]),
    }))
    .filter((g) => g.tasks.length > 0);
  const total = groupTotal(filtered);
  const activeTotal = filtered.reduce(
    (n, g) => n + g.tasks.filter((t) => !t.done).length,
    0,
  );

  /* ── inline create ──────────────────────────────────────── */
  const { data: projects = [] } = useProjects();
  const [newTitle, setNewTitle] = useState('');
  const [metadata, setMetadata] = useState<Partial<TaskInput>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projectLocalId, setProjectLocalId] = useState('');
  const submittingRef = useRef(false);
  const qc = useQueryClient();
  const handleRefresh = useCallback(async () => {
    await qc.invalidateQueries();
  }, [qc]);
  // Set default project once projects are loaded
  if (!projectLocalId && projects.length > 0) {
    const first = projects[0];
    if (first) setProjectLocalId(first.localId);
  }

  const parsed = parseQuickAdd(newTitle);

  // Date picker value: pre-filled from defaultDueDate, independent of
  // metadata so the user's NL-parsed date ("tomorrow") isn't silently
  // overridden by the pre-fill. Only when the user explicitly picks a
  // date does it go into metadata (overriding parsed).
  const [datePicker, setDatePicker] = useState(defaultDueDate?.slice(0, 10) ?? '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // A parsed `+project` token routes the task to that project
    // (case-insensitive title match), overriding the dropdown default.
    const matchedProject = parsed.projectTitle
      ? projects.find(
          (p) => p.title.toLowerCase() === parsed.projectTitle!.toLowerCase(),
        )
      : undefined;
    const pid = matchedProject?.localId || projectLocalId || projects[0]?.localId;
    if (!pid) return;
    if (!parsed.title && !metadata.dueDate && !metadata.priority && !datePicker) return;
    if (submittingRef.current) return;

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      // Resolution: explicit metadata > NL-parsed > default pre-fill > none
      const effectiveDueDate =
        metadata.dueDate !== undefined
          ? metadata.dueDate
          : parsed.dueDate ?? (datePicker || null);

      const input: TaskInput = {
        title: parsed.title || newTitle.trim(),
        projectLocalId: pid,
        ...(effectiveDueDate ? { dueDate: effectiveDueDate } : {}),
        ...(parsed.priority !== null ? { priority: parsed.priority } : {}),
        ...(parsed.repeatAfter !== null ? { repeatAfter: parsed.repeatAfter } : {}),
        ...(parsed.repeatMode !== null ? { repeatMode: parsed.repeatMode } : {}),
        ...metadata,
      };

      const created = await createTask(input);

      // Apply default label for label view
      if (defaultLabelLocalId && created.localId) {
        try {
          await toggleTaskLabel(created.localId, defaultLabelLocalId);
        } catch (err) {
          console.warn('[smart-view] label application failed:', err);
        }
      }

      // Apply parsed labels (the *label token), creating any that don't
      // exist yet.
      if (parsed.labelTitles.length > 0 && created.localId) {
        try {
          await applyLabelsByTitle(created.localId, parsed.labelTitles);
        } catch (err) {
          console.warn('[smart-view] label application failed:', err);
        }
      }

      setNewTitle('');
      setMetadata({});
    } catch (err) {
      console.error('[smart-view] Failed to create task:', err);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* On mobile the title is shown by the app header (large title), so this
          in-content header would duplicate it — desktop only. */}
      {!isMobile && (
        <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-6 py-3">
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
          {activeTotal > 0 ? (
            <span className="text-xs text-[var(--color-muted-foreground)]">
              {activeTotal}
            </span>
          ) : null}
        </header>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        <PullToRefresh onRefresh={handleRefresh}>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Inline create */}
          <form onSubmit={handleSubmit} className="border-b border-[var(--color-border)] px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-4 w-4 items-center justify-center text-[var(--color-muted-foreground)]">
                {isSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </span>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Add a task… e.g. Buy milk tomorrow *groceries !2"
                disabled={isSubmitting}
                className="flex-1 bg-transparent text-sm placeholder-[var(--color-muted-foreground)] focus:outline-none disabled:opacity-50"
              />
            </div>
            <div className="mt-2 flex items-center gap-3 pl-7 text-[var(--color-muted-foreground)]">
              {projects.length > 0 ? (
                <Select value={projectLocalId} onValueChange={setProjectLocalId} disabled={isSubmitting}>
                  <SelectTrigger className="max-w-36 truncate text-xs">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.localId} value={p.localId}>{p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <DatePicker
                value={metadata.dueDate !== undefined ? metadata.dueDate : datePicker || null}
                onChange={(iso) => {
                  setDatePicker(iso ? iso.slice(0, 10) : '');
                  setMetadata({ ...metadata, dueDate: iso });
                }}
                placeholder="Due date"
                disabled={isSubmitting}
              />
            </div>
            <QuickAddPreview parsed={parsed} />
          </form>

          {isLoading && total === 0 ? (
            <p className="p-6 text-sm text-[var(--color-muted-foreground)]">
              Loading…
            </p>
          ) : total === 0 ? (
            <p className="p-6 text-sm text-[var(--color-muted-foreground)]">
              {emptyMessage}
            </p>
          ) : (
            filtered.map((g) => {
              const active = g.tasks.filter((t) => !t.done);
              const completed = g.tasks.filter((t) => t.done);
              return (
                <div key={g.key}>
                  <h2 className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-background)] px-6 py-1.5 text-footnote font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    {g.label}
                    <span className="font-normal normal-case">{active.length}</span>
                  </h2>
                  <ul>
                    {active.map((t) => (
                      <SmartTaskRow
                        key={t.localId}
                        task={t}
                        showProject={showProject}
                      />
                    ))}
                    {completed.length > 0 ? (
                      <li>
                        <div className="mx-3 my-2 overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-accent)]/5">
                          <button
                            type="button"
                            onClick={() => setShowCompleted((s) => !s)}
                            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-footnote text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                          >
                            {showCompleted ? (
                              <ChevronDown className="h-3 w-3 shrink-0" />
                            ) : (
                              <ChevronRight className="h-3 w-3 shrink-0" />
                            )}
                            {showCompleted ? 'Hide' : 'Show'} completed ({completed.length})
                          </button>
                          {showCompleted ? (
                            <ul>
                              {completed.map((t) => (
                                <SmartTaskRow
                                  key={t.localId}
                                  task={t}
                                  showProject={showProject}
                                />
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })
          )}
        </section>
        </PullToRefresh>
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

  const handleClick = useCallback(() => {
    if (!isSwiping) setSelectedTask(task.localId);
  }, [isSwiping, task.localId, setSelectedTask]);

  return (
    <li
      data-task-row=""
      onClick={handleClick}
      className={cn(
        'group flex cursor-pointer items-start gap-3 border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-accent)]/5',
        task.done && 'opacity-60',
        selectedTaskId === task.localId && 'bg-[var(--color-accent)]/10',
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
        className="flex w-full items-start gap-3 pr-6 py-3"
        style={{ position: 'relative', zIndex: 1, background: 'var(--color-card)' }}
      >
        <input
          type="checkbox"
          checked={task.done}
          onChange={handleToggle}
          onClick={(e) => e.stopPropagation()}
          aria-label={task.done ? 'Done' : 'Not done'}
          className="mt-1 h-4 w-4 cursor-pointer rounded accent-[var(--color-primary)]"
        />
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
              <span aria-label={`Priority ${task.priority}`}>
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
    return format(toCalendarDate(iso), 'd MMM');
  } catch {
    return iso;
  }
}

/* ───────────────────────────── view wrappers ───────────────────────── */

function todayISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
}

export function TodayView() {
  const { data: groups = [], isLoading } = useTodayTasks();
  return (
    <SmartView
      title="Today"
      groups={groups}
      isLoading={isLoading}
      emptyMessage="Nothing due today. 🎉"
      showProject
      defaultDueDate={todayISO()}
    />
  );
}

export function UpcomingView() {
  const { data: groups = [], isLoading } = useUpcomingTasks();
  return (
    <SmartView
      title="Upcoming"
      groups={groups}
      isLoading={isLoading}
      emptyMessage="Nothing due in the next 7 days."
      showProject
    />
  );
}

export function LabelView({ labelLocalId }: { labelLocalId: string }) {
  const { data: groups = [], isLoading } = useLabelTasks(labelLocalId);
  const { data: labels = [] } = useLabels();
  const title = labels.find((l) => l.localId === labelLocalId)?.title ?? 'Label';
  return (
    <SmartView
      title={`#${title}`}
      groups={groups}
      isLoading={isLoading}
      emptyMessage="No tasks with this label."
      showProject={false}
      defaultDueDate={todayISO()}
      defaultLabelLocalId={labelLocalId}
    />
  );
}

export function FavoritesView() {
  const { data: groups = [], isLoading } = useFavoriteTasks();
  return (
    <SmartView
      title="Favorites"
      groups={groups}
      isLoading={isLoading}
      emptyMessage="No favorited tasks."
      showProject
      defaultDueDate={todayISO()}
    />
  );
}

export function InboxView() {
  const { data: groups = [], isLoading } = useInboxTasks();
  const title = groups[0]?.label ?? 'Inbox';
  return (
    <SmartView
      title={title}
      groups={groups}
      isLoading={isLoading}
      emptyMessage="No inbox project set. Configure it in your Vikunja server settings."
      showProject={false}
      defaultDueDate={todayISO()}
    />
  );
}
