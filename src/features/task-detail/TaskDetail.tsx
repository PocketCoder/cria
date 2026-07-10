import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, X } from 'lucide-react';
import { useUi } from '@/stores/ui';
import { onShortcut } from '@/lib/shortcutBus';
import { getTaskByLocalId, updateTask } from '@/db/tasks';
import { getProjectByLocalId } from '@/db/projects';
import { searchProjectUsers } from '@/api/users';
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
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/useIsMobile';

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
  const isMobile = useIsMobile();

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
  // On mobile (sheet), click-away is replaced by interactive swipe-down.
  useEffect(() => {
    if (!selectedId) return;
    if (isMobile) return; // sheet uses swipe-down dismiss instead
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

  // Mention picker source: users with access to the task's project
  // (upstream /projects/{id}/projectusers). Off for unsynced projects.
  const { data: taskProject } = useQuery({
    queryKey: ['project-of-task', task?.projectLocalId ?? null],
    queryFn: async () =>
      task ? getProjectByLocalId(task.projectLocalId) : null,
    enabled: !!task,
    staleTime: 60_000,
  });
  const projectServerId = taskProject?.serverId ?? null;
  const mentionSearch = useMemo(
    () =>
      projectServerId != null && projectServerId > 0
        ? (q: string) => searchProjectUsers(projectServerId, q)
        : undefined,
    [projectServerId],
  );

  // Fixed shortcut set: copy family + "open project" (upstream u / . / ⌘.).
  // MUST run before the early returns below — hooks can't be conditional
  // (this exact effect being below them blanked the app on list-Enter).
  useEffect(() => {
    if (!task) return;
    const copyText = async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* clipboard may be unavailable */
      }
    };
    const url = () => {
      const { serverUrl } = getAuthSnapshot();
      return task.serverId && serverUrl
        ? `${serverUrl.replace(/\/+$/, '')}/tasks/${task.serverId}`
        : null;
    };
    const id = task.identifier ?? task.title;
    const subs = [
      onShortcut('task.copyId', () => void copyText(id)),
      onShortcut('task.copyIdTitle', () => void copyText(`${id} ${task.title}`)),
      onShortcut('task.copyIdTitleUrl', () =>
        void copyText(`${id} ${task.title} ${url() ?? ''}`.trim()),
      ),
      onShortcut('task.copyUrl', () => void copyText(url() ?? task.title)),
      onShortcut('task.openProject', () =>
        useUi.getState().setActiveView({ kind: 'project', localId: task.projectLocalId }),
      ),
    ];
    return () => subs.forEach((u) => u());
  });

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

  const taskUrl = () => {
    const { serverUrl } = getAuthSnapshot();
    return task.serverId && serverUrl
      ? `${serverUrl.replace(/\/+$/, '')}/tasks/${task.serverId}`
      : null;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access may be denied in some contexts — silently ignore.
    }
  };

  const handleCopyLink = async () => {
    await copyToClipboard(taskUrl() ?? task.title);
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
          <span className="mr-1.5 text-footnote font-mono uppercase tracking-wide text-[var(--color-muted-foreground)]">
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
        <span className="shrink-0 text-footnote text-[var(--color-primary)] animate-in fade-in">
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
          <h3 className="mb-1 text-footnote font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Description
          </h3>
          <RichTextEditor
            value={task.description}
            onSave={handleDescriptionSave}
            taskLocalId={task.localId}
            taskServerId={task.serverId}
            mentionSearch={mentionSearch}
          />
        </section>

        <CommentSection
          taskLocalId={task.localId}
          taskServerId={task.serverId}
          mentionSearch={mentionSearch}
        />

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
  const isMobile = useIsMobile();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetOffset, setSheetOffset] = useState(0);
  const offsetRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Interactive sheet dismiss: pull DOWN from the top to close. It must not
  // fight the inner scroll, so it only engages when the content is at the top
  // and the gesture is a decisive *downward* drag (mirrors PullToRefresh's
  // arbitration). Listeners stay attached for the whole gesture — `sheetOffset`
  // is intentionally NOT a dep (it changes every move) and onClose is read via
  // a ref, so the effect never re-runs mid-drag (which was causing the jank).
  useEffect(() => {
    if (!isMobile) return;
    const el = sheetRef.current;
    if (!el) return;

    const THRESHOLD = 8;
    let startX = 0;
    let startY = 0;
    let atTop = false;
    let dragging = false;
    let decided = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0]!.clientX;
      startY = e.touches[0]!.clientY;
      atTop = el.scrollTop <= 0;
      dragging = false;
      decided = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (!dragging) {
        if (decided || !atTop) return; // a scroll, not a dismiss
        const dx = e.touches[0]!.clientX - startX;
        const dy = e.touches[0]!.clientY - startY;
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        // Only a downward, vertical drag dismisses; anything else is a scroll.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          decided = true;
          return;
        }
        dragging = true;
        decided = true;
        startY = e.touches[0]!.clientY; // reset baseline so the offset starts at 0
      }
      // Committed to a dismiss drag — take over from native scroll.
      e.preventDefault();
      const dy = Math.max(0, e.touches[0]!.clientY - startY);
      offsetRef.current = dy;
      setSheetOffset(dy);
    };

    const onTouchEnd = () => {
      if (!dragging) return;
      dragging = false;
      const dy = offsetRef.current;
      offsetRef.current = 0;
      if (dy > 120) onCloseRef.current();
      else setSheetOffset(0);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isMobile]);

  return (
    <>
      {isMobile && (
        <div className="sheet-backdrop fixed inset-0 z-40" onClick={onClose} />
      )}
      <aside
        ref={cardRef}
        role="dialog"
        aria-label="Task details"
        className={cn(
          'flex flex-col overflow-hidden',
          isMobile
            ? // iOS-style sheet: slides up from bottom with rounded top corners,
              // a grab handle, and spring animation. Interactive pull-down dismiss.
              'fixed inset-x-0 bottom-0 z-50 max-h-[90vh] rounded-t-2xl bg-[var(--color-card)] shadow-[0_-4px_20px_rgba(0,0,0,0.15)] animate-[sheet-up_350ms_var(--spring-snappy)]'
            : // Right-docked floating inspector on desktop (in-flow flex item).
              'glass-surface glass-specular relative m-4 w-[420px] max-w-[calc(100%-2rem)] shrink-0 rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.45)] animate-[card-slide-in_180ms_ease-out]',
        )}
        style={isMobile && sheetOffset > 0 ? { transform: `translateY(${sheetOffset}px)`, transition: 'none' } : undefined}
      >
        <div ref={sheetRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {isMobile && (
            // Grab handle for interactive sheet dismiss
            <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-[var(--color-muted-foreground)]/30" />
          )}
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
            <div className="min-w-0 flex-1">
              {header ?? (
                <span className="text-footnote font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
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
        </div>
      </aside>
    </>
  );
}
