import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useUi } from '@/stores/ui';
import { getTaskByLocalId, updateTask } from '@/db/tasks';
import { subscribe } from '@/db/bus';
import { useTaskLabels } from '@/queries/taskLabels';
import { LabelChips } from '@/features/tasks/LabelChips';
import { RichTextEditor } from './RichTextEditor';
import { TaskActions } from './TaskActions';
import type { Task } from '@/domain/task';

/**
 * Task detail, rendered as a right-docked floating inspector card rather
 * than a permanent third column. Shows only when a task is selected;
 * closes via the X button or Escape. There is intentionally **no
 * backdrop** — the task list and sidebar stay live underneath, so
 * clicking another task swaps the card's contents in place.
 *
 * Positioned `absolute`, so its parent (the pane row in Shell) must be
 * `relative`. Height tracks the content area (top-3/bottom-3 inset),
 * keeping the app header + footer reachable.
 */
export function TaskDetail() {
  // **All hooks before any early return** — React's hook-order rule.
  const selectedId = useUi((s) => s.selectedTaskLocalId);
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const queryClient = useQueryClient();
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  useEffect(() => {
    return subscribe('tasks', () => {
      void queryClient.invalidateQueries({ queryKey: ['task'] });
    });
  }, [queryClient]);

  // Escape closes the card while it's open.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedTask(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
      <DetailCard onClose={close}>
        <p className="p-5 text-sm text-[var(--color-muted-foreground)]">
          Loading…
        </p>
      </DetailCard>
    );
  }

  if (isError || !task) {
    return (
      <DetailCard onClose={close}>
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

  return (
    <DetailCard onClose={close}>
      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        {titleEditing ? (
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void handleTitleSave()}
            onKeyDown={handleTitleKeyDown}
            autoFocus
            className="mb-2 w-full rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-base font-semibold leading-tight focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          />
        ) : (
          <h2
            className="mb-2 cursor-pointer break-words rounded px-1 py-0.5 text-base font-semibold leading-tight hover:bg-[var(--color-muted)]"
            onClick={handleTitleEdit}
            title="Click to edit"
          >
            {task.title}
          </h2>
        )}

        {labels.length > 0 ? (
          <div className="mb-3">
            <LabelChips labels={labels} />
          </div>
        ) : null}

        <section className="mb-4">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Description
          </h3>
          <RichTextEditor
            value={task.description}
            onSave={handleDescriptionSave}
          />
        </section>

        <div className="space-y-1">
          <TaskActions task={task} onDeleted={handleDeleted} />
        </div>
      </div>
    </DetailCard>
  );
}

/**
 * The floating card chrome: right-docked, rounded, opaque, soft shadow,
 * with a thin header strip carrying the close button. Slides in on mount.
 */
function DetailCard({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside
      role="dialog"
      aria-label="Task details"
      className="absolute right-3 top-3 bottom-3 z-20 flex w-[460px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl animate-[card-slide-in_180ms_ease-out]"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          Task
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded p-1 text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      {children}
    </aside>
  );
}
