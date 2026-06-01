import { useState, useRef } from 'react';
import { format } from 'date-fns';
import { Plus, Loader2, Trash2, Paperclip } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUi } from '@/stores/ui';
import { createTask, updateTask } from '@/db/tasks';
import { applyLabelsByTitle, toggleTaskLabel } from '@/db/labels';
import { useLabels } from '@/queries/labels';
import { useProjects } from '@/queries/projects';
import { usePendingDeletes } from '@/stores/pendingDeletes';
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
  const pendingDeletes = usePendingDeletes((s) => s.pending);
  const filtered = groups
    .map((g) => ({
      ...g,
      tasks: g.tasks.filter((t) => !pendingDeletes[t.localId]),
    }))
    .filter((g) => g.tasks.length > 0);
  const total = groupTotal(filtered);

  /* ── inline create ──────────────────────────────────────── */
  const { data: projects = [] } = useProjects();
  const [newTitle, setNewTitle] = useState('');
  const [metadata, setMetadata] = useState<Partial<TaskInput>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projectLocalId, setProjectLocalId] = useState('');
  const submittingRef = useRef(false);
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
    const pid = projectLocalId || projects[0]?.localId;
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

      // Apply parsed #labels (creating any that don't exist yet)
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
      <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-6 py-3">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {total > 0 ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {total}
          </span>
        ) : null}
      </header>

      <div className="flex min-h-0 min-w-0 flex-1">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
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
                placeholder="Add a task… e.g. Buy milk tomorrow #label !2"
                disabled={isSubmitting}
                className="flex-1 bg-transparent text-sm placeholder-[var(--color-muted-foreground)] focus:outline-none disabled:opacity-50"
              />
            </div>
            <div className="mt-2 flex items-center gap-3 pl-7 text-[var(--color-muted-foreground)]">
              <select
                value={projectLocalId}
                onChange={(e) => setProjectLocalId(e.target.value)}
                className="text-xs max-w-36 truncate"
                disabled={isSubmitting}
              >
                {projects.length === 0 && <option value="">No projects</option>}
                {projects.map((p) => (
                  <option key={p.localId} value={p.localId}>
                    {p.title}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={datePicker}
                onChange={(e) => {
                  setDatePicker(e.target.value);
                  setMetadata({ ...metadata, dueDate: e.target.value || null });
                }}
                className="text-xs"
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
            filtered.map((g) => (
              <div key={g.key}>
                <h2 className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-background)] px-6 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {g.label}
                  <span className="font-normal normal-case">{g.tasks.length}</span>
                </h2>
                <ul>
                  {g.tasks.map((t) => (
                    <SmartTaskRow
                      key={t.localId}
                      task={t}
                      showProject={showProject}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
        <TaskDetail />
      </div>
    </>
  );
}

export function SmartTaskRow({
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

  const handleToggle = async () => {
    try {
      await updateTask(task.localId, { done: !task.done });
    } catch (err) {
      console.error('Failed to toggle task:', err);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    enqueueDelete(task);
  };

  return (
    <li
      data-task-row=""
      onClick={() => setSelectedTask(task.localId)}
      className={cn(
        'group flex cursor-pointer items-start gap-3 border-b border-[var(--color-border)] px-6 py-3 transition-colors hover:bg-[var(--color-accent)]/5',
        task.done && 'opacity-60',
        selectedTaskId === task.localId && 'bg-[var(--color-accent)]/10',
      )}
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
        <p
          className={cn(
            'truncate text-sm',
            task.done && 'text-[var(--color-muted-foreground)] line-through',
          )}
        >
          {task.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-muted-foreground)]">
          {showProject ? <span>{task.projectTitle}</span> : null}
          {task.dueDate ? <span>{formatDue(task.dueDate)}</span> : null}
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
    </li>
  );
}

function formatDue(iso: string): string {
  try {
    return format(new Date(iso), 'd MMM');
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
