import { useEffect, useRef } from 'react';
import { Star, Ellipsis, X, Plus, Bell, Paperclip, MessageSquare, RefreshCw, Check, ChevronRight, Link2 } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/useIsMobile';
import { updateTask } from '@/db/tasks';
import type { TaskReminder } from '@/db/reminders';
import type { Task } from '@/domain/task';
import type { DateFormatters } from '@/lib/dateFormat';
import type { MentionSearch } from './mentionExtension';
import { toggleTaskDone } from '@/features/tasks/taskRowHelpers';
import { TaskActions, InlineRepeat } from './TaskActions';
import { AttachmentList } from './AttachmentList';
import { ReminderList } from './ReminderList';
import { CommentSection } from './CommentSection';
import { RelatedTasks } from './RelatedTasks';
import {
  countValue,
  reminderSummary,
  taskRepeatLabel,
  toggleSection,
  type OpenSection,
} from './taskDetailLogic';

const CHROME_BUTTON =
  'flex items-center justify-center rounded text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer';

/** Favourite / overflow (copy link) / close strip at the top of the card. */
export function DetailChrome({
  task,
  copied,
  onCopyLink,
  onClose,
}: {
  task: Task;
  copied: boolean;
  onCopyLink: () => void;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  // 44pt touch targets on mobile, compact on desktop.
  const btn = cn(CHROME_BUTTON, isMobile ? 'h-11 w-11' : 'h-7 w-7');
  const icon = isMobile ? 'h-5 w-5' : 'h-[15px] w-[15px]';
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => void updateTask(task.localId, { isFavorite: !task.isFavorite })}
        aria-label={task.isFavorite ? 'Unfavourite' : 'Favourite'}
        className={btn}
      >
        <Star
          className={icon}
          style={{ color: task.isFavorite ? 'var(--color-warning-text)' : undefined }}
          fill={task.isFavorite ? 'currentColor' : 'none'}
        />
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="More actions" className={btn}>
            <Ellipsis className={icon} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-44 p-1">
          <button
            type="button"
            onClick={onCopyLink}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-[var(--color-muted)] cursor-pointer"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-[var(--color-success-text)]" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </PopoverContent>
      </Popover>
      <button type="button" onClick={onClose} aria-label="Close details" className={btn}>
        <X className={icon} />
      </button>
    </div>
  );
}

/** Click-to-edit task title. */
export function TaskTitle({
  task,
  editing,
  setEditing,
  draft,
  setDraft,
  flush = false,
}: {
  task: Task;
  editing: boolean;
  setEditing: (v: boolean) => void;
  draft: string;
  setDraft: (v: string) => void;
  /** Drop the bottom margin (the caller lays the title out in a row). */
  flush?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Leaving the input with Enter/Escape unmounts the focused element; hand
  // focus back to the title button so keyboard users keep their place. A blur
  // save must not do this (focus already went somewhere else on purpose).
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.title) {
      await updateTask(task.localId, { title: trimmed });
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      restoreFocus.current = true;
      void handleSave();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      restoreFocus.current = true;
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        aria-label="Task title"
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void handleSave()}
        onKeyDown={handleKeyDown}
        autoFocus
        className={cn(flush ? '' : 'mb-[18px]', 'w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-1.5 py-0.5 text-title font-semibold leading-[1.28] tracking-tight focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]')}
      />
    );
  }
  return (
    <h2
      data-inspector-title
      className={cn(
        'vt-task-title w-fit max-w-full text-title font-semibold leading-[1.28] tracking-tight',
        !flush && 'mb-[18px]',
      )}
    >
      <button
        ref={buttonRef}
        type="button"
        className="block w-full cursor-pointer text-left transition-colors hover:opacity-80"
        onClick={() => {
          setDraft(task.title);
          setEditing(true);
        }}
        title="Click to edit"
      >
        {task.title}
      </button>
    </h2>
  );
}

function CollapsedRow({
  icon,
  label,
  value,
  hint,
  expanded,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  hint?: string;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-t border-[var(--color-border)] py-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 rounded-[7px] px-1.5 py-2 text-left text-[13.5px] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
      >
        <span className="shrink-0 text-[var(--color-muted-foreground)]">{icon}</span>
        <span className="flex-1">{label}</span>
        {hint ? (
          <span className="text-[11.5px] text-[var(--color-muted-foreground)]">{hint}</span>
        ) : value ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">{value}</span>
        ) : null}
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)] transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded ? <div className="section-expand"><div className="min-h-0 overflow-hidden pb-1">{children}</div></div> : null}
    </div>
  );
}

const ICON = 'h-[15px] w-[15px]';

/** The collapsible Reminders / Attachments / Comments / Related / Repeat / More rows. */
export function DetailSections({
  task,
  openSection,
  setOpenSection,
  reminders,
  attachmentCount,
  commentCount,
  relatedCount,
  mentionSearch,
  dateFmt,
  onDeleted,
}: {
  task: Task;
  openSection: OpenSection;
  setOpenSection: (s: OpenSection) => void;
  reminders: TaskReminder[];
  attachmentCount: number;
  commentCount: number;
  relatedCount: number;
  mentionSearch: MentionSearch | undefined;
  dateFmt: DateFormatters;
  onDeleted: () => void;
}) {
  const toggle = (section: Exclude<OpenSection, null>) => () =>
    setOpenSection(toggleSection(openSection, section));
  return (
    <div className="mt-5 border-t border-[var(--color-border)] pt-1.5">
      <CollapsedRow
        icon={<Bell className={ICON} />}
        label="Reminders"
        value={reminderSummary(reminders, dateFmt)}
        expanded={openSection === 'reminders'}
        onToggle={toggle('reminders')}
      >
        <ReminderList taskLocalId={task.localId} hideHeader />
      </CollapsedRow>
      <CollapsedRow
        icon={<Paperclip className={ICON} />}
        label="Attachments"
        value={countValue(attachmentCount)}
        expanded={openSection === 'attachments'}
        onToggle={toggle('attachments')}
      >
        <AttachmentList taskLocalId={task.localId} taskServerId={task.serverId} hideHeader />
      </CollapsedRow>
      <CollapsedRow
        icon={<MessageSquare className={ICON} />}
        label="Comments"
        value={countValue(commentCount)}
        expanded={openSection === 'comments'}
        onToggle={toggle('comments')}
      >
        <CommentSection
          taskLocalId={task.localId}
          taskServerId={task.serverId}
          mentionSearch={mentionSearch}
          hideHeader
        />
      </CollapsedRow>
      <CollapsedRow
        icon={<Link2 className={ICON} />}
        label="Related"
        value={countValue(relatedCount)}
        expanded={openSection === 'related'}
        onToggle={toggle('related')}
      >
        <RelatedTasks
          taskLocalId={task.localId}
          taskServerId={task.serverId}
          hideHeader
          excludeSubtasks
        />
      </CollapsedRow>
      <CollapsedRow
        icon={<RefreshCw className={ICON} />}
        label="Repeat"
        value={taskRepeatLabel(task)}
        expanded={openSection === 'repeat'}
        onToggle={toggle('repeat')}
      >
        <InlineRepeat task={task} />
      </CollapsedRow>
      <CollapsedRow
        icon={<Ellipsis className={ICON} />}
        label="More"
        value={undefined}
        hint="progress · move · duplicate"
        expanded={openSection === 'more'}
        onToggle={toggle('more')}
      >
        <div className="px-1 pb-1">
          <TaskActions task={task} onDeleted={onDeleted} />
        </div>
      </CollapsedRow>
    </div>
  );
}

export function MarkDoneButton({ task }: { task: Task }) {
  return (
    <button
      type="button"
      onClick={() => void toggleTaskDone(task)}
      className="mt-[22px] flex w-full items-center justify-center gap-2 rounded-[9px] bg-[var(--color-inverse)] px-3 py-[11px] text-[13.5px] font-medium text-[var(--color-inverse-foreground)] transition-opacity hover:opacity-90 cursor-pointer"
    >
      <Check className="h-[15px] w-[15px]" strokeWidth={2} />
      {task.done ? 'Mark not done' : 'Mark done'}
    </button>
  );
}
