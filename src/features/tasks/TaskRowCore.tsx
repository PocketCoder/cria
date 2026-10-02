import { memo, useMemo, useState } from 'react';
import { Paperclip, RefreshCw, CheckSquare, Square } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isRepeating } from '@/lib/repeatLabel';
import { priorityColor } from '@/components/ui/priority';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { TaskCheck } from '@/components/ui/task-check';
import { TaskHoverPreview } from './TaskHoverPreview';
import { LabelChips } from './LabelChips';
import { formatDue, isOverdue, toggleTaskDone, countSuppressedSignals } from './taskRowHelpers';
import { Check } from 'lucide-react';
import type { Task } from '@/domain/task';
import type { Label } from '@/domain/label';

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
      {isRepeating(task.repeatAfter, task.repeatMode) ? (
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

/* ─── date · project · +n ─── */

interface RowMetaProps extends RowSignals {
  task: Task;
  projectTitle: string | null;
}

function RowMeta({ task, labels, hasAttachments, checklist, projectTitle }: RowMetaProps) {
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
      countSuppressedSignals({
        labelCount: labels.length,
        hasAttachments,
        checklistTotal: checklist.total,
        repeatAfter: task.repeatAfter,
        repeatMode: task.repeatMode,
        percentDone: task.percentDone,
        hexColor: task.hexColor,
      }),
    [labels.length, hasAttachments, checklist.total, task.repeatAfter, task.repeatMode, task.percentDone, task.hexColor],
  );

  return (
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
}

/* ─── select toggle or done checkbox ─── */

interface RowLeadingProps {
  task: Task;
  selecting: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onToggleSelect?: () => void;
}

function RowLeading({ task, selecting, isSelected, onToggle, onToggleSelect }: RowLeadingProps) {
  if (selecting) {
    return (
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
    );
  }
  return <TaskCheck checked={task.done} onToggle={onToggle} />;
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
  style?: React.CSSProperties;
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
  style,
  titleWeight = 'normal',
}: TaskRowCoreProps) {
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

  return (
    <div
      data-task-row={task.localId}
      data-done={task.done || undefined}
      // Pointer convenience only: the title below is the focusable control, and
      // its click bubbles up here.
      role="presentation"
      onClick={onOpen}
      style={style}
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
        <RowLeading
          task={task}
          selecting={selecting}
          isSelected={isSelected}
          onToggle={handleToggle}
          onToggleSelect={onToggleSelect}
        />
        {titleSlot ?? (
          <TaskHoverPreview task={task} className="min-w-0 flex-1">
            {onOpen ? (
              // No onClick of its own: Enter/Space synthesise a click that
              // bubbles to the row's onOpen.
              <button
                type="button"
                className={cn(
                  'block w-full cursor-pointer truncate text-left text-sm leading-snug',
                  titleWeight === 'medium' && 'font-medium',
                  task.done && 'text-[var(--color-muted-foreground)]',
                )}
                title={task.title}
              >
                <span className="task-strike" data-done={task.done || undefined}>
                  {task.title}
                </span>
              </button>
            ) : (
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
            )}
          </TaskHoverPreview>
        )}
        <span className="ml-auto flex shrink-0 items-center">
          <RowMeta
            task={task}
            labels={labels}
            hasAttachments={hasAttachments}
            checklist={checklist}
            projectTitle={projectTitle}
          />
        </span>
      </div>
      {actions}
    </div>
  );
});
