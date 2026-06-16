import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, X } from 'lucide-react';
import { useUi } from '@/stores/ui';
import { getTaskByLocalId, updateTask } from '@/db/tasks';
import { toggleTaskLabel } from '@/db/labels';
import { subscribe } from '@/db/bus';
import { useTaskLabels } from '@/queries/taskLabels';
import { LabelChips } from '@/features/tasks/LabelChips';
import { RichTextEditor } from './RichTextEditor';
import { TaskActions } from './TaskActions';
import { AttachmentList } from './AttachmentList';
import { ReminderList } from './ReminderList';
import { RelatedTasks } from './RelatedTasks';
import { CommentSection } from './CommentSection';
import type { Task } from '@/domain/task';
import { getAuthSnapshot } from '@/auth/store';

/**
 * Task detail, rendered as a right-docked floating card rather than a
 * permanent column. Shows only when a task is selected; closes via the X
 * button or Escape.
 *
 * It's an **in-flow flex item**, not an overlay: the card sits beside the
 * list and pushes it narrower, so nothing gets clipped under it (no
 * backdrop, no seam). Its `m-4` margin is the gutter the shadow casts
 * into, which is what sells the "floating" read. The list stays fully
 * visible + clickable beside it, so clicking another task swaps the
 * card's contents in place.
 */
export function TaskDetail() {
  // **All hooks before any early return** — React's hook-order rule.
  const selectedId = useUi((s) => s.selectedTaskLocalId);
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const queryClient = useQueryClient();
  const cardRef = useRef<HTMLElement>(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return subscribe('tasks', () => {
      void queryClient.invalidateQueries({ queryKey: ['task'] });
    });
  }, [queryClient]);

  // Reset title-edit state whenever the selected task changes. Without
  // this, switching from task A (mid-title-edit) to task B leaves the
  // header in edit mode showing A's draft; the subsequent blur-save
  // then writes A's text onto B (handleTitleSave reads the *current*
  // task, which is now B). Discarding the in-progress draft on
  // navigation is the safe, predictable behaviour.
  useEffect(() => {
    setTitleEditing(false);
    setTitleDraft('');
  }, [selectedId]);

  // Escape closes the card while it's open.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedTask(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, setSelectedTask]);

  // Click-away closes the card, with three exceptions:
  //  - inside the card (incl. the fixed-but-DOM-nested slash menu);
  //  - inside a portaled Radix popper (the date picker lives in a body
  //    portal — closing the card mid-date-pick would be maddening);
  //  - on another task row — let the row's own click swap the card's
  //    contents in place instead of close-then-reopen (no re-animation).
  // pointerdown (not click) so dismissal feels immediate.
  useEffect(() => {
    if (!selectedId) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (target.closest('[data-radix-popper-content-wrapper]')) return;
      if (target.closest('[data-task-row]')) return;
      setSelectedTask(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [selectedId, setSelectedTask]);

  const { data: task, isLoading, isError } = useQuery<Task | null>({
    queryKey: ['task', selectedId],
    queryFn: async () => (selectedId ? getTaskByLocalId(selectedId) : null),
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  const { data: labels = [] } = useTaskLabels(selectedId);

  if (!selectedId) return null;

  const close = () => setSelectedTask(null);

  if (isLoading) {
    return (
      <DetailCard onClose={close} cardRef={cardRef}>
        <p className="p-5 text-sm text-[var(--color-muted-foreground)]">
          Loading…
        </p>
      </DetailCard>
    );
  }

  if (isError || !task) {
    return (
      <DetailCard onClose={close} cardRef={cardRef}>
        <p className="p-5 text-sm text-[var(--color-warning)]">
          Could not load task details.
        </p>
      </DetailCard>
    );
  }

  const handleTitleEdit = () => {
    setTitleDraft(task.title);
    setTitleEditing(true);
  };

  const handleTitleSave = async () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== task.title) {
      await updateTask(task.localId, { title: trimmed });
    }
    setTitleEditing(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleTitleSave();
    } else if (e.key === 'Escape') {
      // Cancel the title edit without closing the whole card.
      e.stopPropagation();
      setTitleEditing(false);
    }
  };

  const handleDescriptionSave = async (next: string) => {
    await updateTask(task.localId, { description: next });
  };

  const handleDeleted = () => {
    setSelectedTask(null);
  };

  const handleRemoveLabel = async (labelLocalId: string) => {
    // The label is currently applied, so toggleTaskLabel removes it
    // (soft-delete + queued 'remove' outbox op). Invalidate explicitly:
    // toggleTaskLabel notifies the 'task_labels' bus topic, and we
    // refresh the chip query immediately rather than wait for a pull.
    try {
      await toggleTaskLabel(task.localId, labelLocalId);
      await queryClient.invalidateQueries({ queryKey: ['task-labels'] });
    } catch (err) {
      console.error('[labels] remove failed:', err);
    }
  };

  const handleCopyLink = async () => {
    const { serverUrl } = getAuthSnapshot();
    let text = task.title;
    if (task.serverId && serverUrl) {
      text = `${serverUrl.replace(/\/+$/, '')}/tasks/${task.serverId}`;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access may be denied in some contexts — silently ignore.
    }
  };

  // The title lives in the card header (sticky context as the body
  // scrolls), still click-to-edit inline.
  const header = titleEditing ? (
    <input
      type="text"
      value={titleDraft}
      onChange={(e) => setTitleDraft(e.target.value)}
      onBlur={() => void handleTitleSave()}
      onKeyDown={handleTitleKeyDown}
      autoFocus
      className="w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-1.5 py-0.5 text-sm font-semibold leading-tight focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
    />
  ) : (
    <div className="flex items-center gap-1">
      <h2
        className="min-w-0 flex-1 cursor-pointer truncate rounded px-1 py-0.5 text-sm font-semibold leading-tight hover:bg-[var(--color-muted)]"
        onClick={handleTitleEdit}
        title="Click to edit"
      >
        {task.identifier ? (
          <span className="mr-1.5 text-[10px] font-mono uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {task.identifier}
          </span>
        ) : null}
        {task.title}
      </h2>
      <button
        type="button"
        onClick={() => void handleCopyLink()}
        className="shrink-0 rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
        title={
          task.serverId
            ? 'Copy task link to clipboard'
            : 'Task not synced yet — copy title instead'
        }
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      {copied ? (
        <span className="shrink-0 text-[10px] text-[var(--color-primary)] animate-in fade-in">
          Copied!
        </span>
      ) : null}
    </div>
  );

  return (
    <DetailCard onClose={close} header={header} cardRef={cardRef}>
      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        {labels.length > 0 ? (
          <div className="mb-3">
            <LabelChips
              labels={labels}
              onRemove={(id) => void handleRemoveLabel(id)}
            />
          </div>
        ) : null}

        <section className="mb-4">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Description
          </h3>
          <RichTextEditor
            value={task.description}
            onSave={handleDescriptionSave}
            taskLocalId={task.localId}
            taskServerId={task.serverId}
          />
        </section>

        <CommentSection taskLocalId={task.localId} taskServerId={task.serverId} />

        <ReminderList taskLocalId={task.localId} />

        <RelatedTasks
          taskLocalId={task.localId}
          taskServerId={task.serverId}
        />

        <AttachmentList
          taskLocalId={task.localId}
          taskServerId={task.serverId}
        />

        <div className="space-y-1">
          <TaskActions task={task} onDeleted={handleDeleted} />
        </div>
      </div>
    </DetailCard>
  );
}

/**
 * The floating card chrome: right-docked, rounded, opaque, with a margin
 * gutter + soft shadow that make it read as elevated above the list. The
 * header strip carries the task title (or a fallback label) on the left
 * and the close button on the right.
 */
function DetailCard({
  onClose,
  header,
  cardRef,
  children,
}: {
  onClose: () => void;
  header?: React.ReactNode;
  cardRef?: React.Ref<HTMLElement>;
  children: React.ReactNode;
}) {
  return (
    <aside
      ref={cardRef}
      role="dialog"
      aria-label="Task details"
      className="m-4 flex w-[420px] max-w-[calc(100%-2rem)] shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-[0_10px_40px_-10px_rgba(0,0,0,0.45)] animate-[card-slide-in_180ms_ease-out]"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <div className="min-w-0 flex-1">
          {header ?? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Task
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="shrink-0 rounded p-1 text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      {children}
    </aside>
  );
}
