import { memo, useMemo, useState } from 'react';
import { format, startOfDay, isBefore } from 'date-fns';
import { Paperclip, RefreshCw, CheckSquare, Square } from 'lucide-react';
import { cn } from '@/lib/cn';
import { toCalendarDate, hasTimeOfDay, formatTime } from '@/lib/dateFormat';
import { priorityColor } from '@/components/ui/priority-select';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { TaskCheck } from '@/components/ui/task-check';
import { TaskHoverPreview } from './TaskHoverPreview';
import { LabelChips } from './LabelChips';
import { updateTask } from '@/db/tasks';
import { playCompletionSound } from '@/utils/sound';
import { impactComplete } from '@/utils/haptics';
import { Check } from 'lucide-react';
import type { Task } from '@/domain/task';
import type { Label } from '@/domain/label';

/* ─── shared helpers ─── */

export function formatDue(iso: string): string {
  try {
    const base = format(toCalendarDate(iso), 'd MMM');
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
    return isBefore(startOfDay(toCalendarDate(iso)), startOfDay(new Date()));
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

/* ─── +n suppressed-signals popover ─── */

interface RowSignals {
  hasAttachments: boolean;
  checklist: { checked: number; total: number };
  labels: Label[];
}

function SuppressedSignals({ task, signals }: { task: Task; signals: RowSignals }) {
  const { hasAttachments, checklist, labels } = signals;
  return (
    <div className="flex max-w-[260px] flex-col gap-2 text-xs text-[var(--color-muted-foreground)]">
      {labels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <LabelChips labels={labels} />
        </div>
      ) : null}
      {hasAttachments ? (
        <span className="flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5 shrink-0" />
          Attachments
        </span>
      ) : null}
      {checklist.total > 0 ? (
        <span className="flex items-center gap-1.5">
          {checklist.checked === checklist.total ? (
            <CheckSquare className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" />
          ) : (
            <Square className="h-3.5 w-3.5 shrink-0" />
          )}
          Checklist {checklist.checked}/{checklist.total}
        </span>
      ) : null}
      {task.repeatAfter > 0 ? (
        <span className="flex items-center gap-1.5">
          <RefreshCw className="h-3.5 w-3.5 shrink-0" />
          Repeats
        </span>
      ) : null}
      {task.percentDone > 0 ? (
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-border)]">
            <span
              className="block h-full rounded-full bg-[var(--color-primary)]"
              style={{ width: `${Math.min(100, task.percentDone)}%` }}
            />
          </span>
          <span className="tabular-nums">{Math.round(task.percentDone)}%</span>
        </span>
      ) : null}
      {task.hexColor ? (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: task.hexColor }}
          />
          Colour
        </span>
      ) : null}
    </div>
  );
}

/* ─── the shared row ─── */

export interface TaskRowCoreProps {
  task: Task;
  labels?: Label[];
  hasAttachments?: boolean;
  checklist?: { checked: number; total: number };
  /** Project name shown after the due date (smart views); omit in-project lists. */
  projectTitle?: string | null;
  selecting?: boolean;
  isSelected?: boolean;
  /** Detail card open for this task (highlight). */
  isOpen?: boolean;
  /** Owning list can snapshot the row for the completion collapse animation. */
  onToggle?: () => void;
  onToggleSelect?: () => void;
  onOpen?: () => void;
  /** Trailing hover actions (delete/edit buttons) rendered by the caller. */
  actions?: React.ReactNode;
  /** Replaces the default title entirely (e.g. inline rename input). */
  titleSlot?: React.ReactNode;
  /** Padding + density overrides (caller owns px / py). */
  className?: string;
  titleWeight?: 'normal' | 'medium';
}

/**
 * The task row: `[3px priority bar][checkbox][title…][date · project · +n]`.
 * Everything after the title is 12px muted-foreground, right-aligned, in fixed
 * order (date → project → +n). Suppressed signals (labels, attachments,
 * checklist, repeat, percent, colour) collapse into the `+n` popover — the row
 * itself renders nothing else.
 */
export const TaskRowCore = memo(function TaskRowCore({
  task,
  labels = [],
  hasAttachments = false,
  checklist = { checked: 0, total: 0 },
  projectTitle = null,
  selecting = false,
  isSelected = false,
  isOpen = false,
  onToggle,
  onToggleSelect,
  onOpen,
  actions,
  titleSlot,
  className,
  titleWeight = 'normal',
}: TaskRowCoreProps) {
  const dueLabel = useMemo(
    () => (task.dueDate ? formatDue(task.dueDate) : null),
    [task.dueDate],
  );
  const overdue = useMemo(
    () => (task.dueDate ? isOverdue(task.dueDate) : false),
    [task.dueDate],
  );

  const suppressed = useMemo(
    () =>
      (labels.length > 0 ? 1 : 0) +
      (hasAttachments ? 1 : 0) +
      (checklist.total > 0 ? 1 : 0) +
      (task.repeatAfter > 0 ? 1 : 0) +
      (task.percentDone > 0 ? 1 : 0) +
      (task.hexColor ? 1 : 0),
    [labels.length, hasAttachments, checklist.total, task.repeatAfter, task.percentDone, task.hexColor],
  );

  // Row glow plays on a false→true change, never on mount (the class drops
  // on un-complete, so re-completing replays it).
  const [prevDone, setPrevDone] = useState(task.done);
  const [glow, setGlow] = useState(false);
  if (prevDone !== task.done) {
    setPrevDone(task.done);
    setGlow(task.done);
  }

  const handleToggle = () => {
    if (onToggle) onToggle();
    else void toggleTaskDone(task);
  };

  const meta = (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
      {dueLabel ? (
        <span className={cn('whitespace-nowrap tabular-nums', overdue && 'text-[var(--color-destructive)]')}>
          {dueLabel}
        </span>
      ) : null}
      {projectTitle ? <span className="truncate">{projectTitle}</span> : null}
      {suppressed > 0 ? (
        <span className="shrink-0">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`${suppressed} more`}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="rounded px-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]"
              >
                +{suppressed}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="p-2.5">
              <SuppressedSignals task={task} signals={{ hasAttachments, checklist, labels }} />
            </PopoverContent>
          </Popover>
        </span>
      ) : null}
    </span>
  );

  return (
    <div
      data-task-row={task.localId}
      data-done={task.done || undefined}
      onClick={onOpen}
      className={cn(
        'task-row group relative flex cursor-pointer items-center gap-3 hover:bg-[var(--color-accent)]/5',
        glow && 'row-glow',
        isSelected && 'bg-[var(--color-primary)]/10',
        isOpen && 'bg-[var(--color-accent)]/10',
        className,
      )}
    >
      {/* 3px priority bar — nothing for priorities 0–2. */}
      {task.priority > 2 ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px] rounded-r"
          style={{ background: priorityColor(task.priority) }}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {selecting ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect?.();
            }}
            aria-label={isSelected ? 'Deselect' : 'Select'}
            className={cn(
              'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border',
              isSelected
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                : 'border-[var(--color-muted-foreground)]',
            )}
          >
            {isSelected && <Check className="h-3 w-3" />}
          </button>
        ) : (
          <TaskCheck checked={task.done} onToggle={handleToggle} />
        )}
        {titleSlot ?? (
          <TaskHoverPreview task={task} className="min-w-0 flex-1">
            <p
              className={cn(
                'truncate text-sm leading-snug',
                titleWeight === 'medium' && 'font-medium',
                task.done && 'text-[var(--color-muted-foreground)]',
              )}
              title={task.title}
            >
              <span className="task-strike" data-done={task.done || undefined}>
                {task.title}
              </span>
            </p>
          </TaskHoverPreview>
        )}
        <span className="ml-auto flex shrink-0 items-center">{meta}</span>
      </div>
      {actions}
    </div>
  );
});
