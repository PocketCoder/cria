import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { useKanbanBoard, type KanbanColumn } from '@/queries/kanban';
import { createTask } from '@/db/tasks';
import { setTaskBucket, createBucket, deleteBucket, updateBucket } from '@/db/buckets';
import { updateView } from '@/db/views';
import { useUi } from '@/stores/ui';
import { parseQuickAdd } from '@/lib/quickAddParser';
import { applyLabelsByTitle } from '@/db/labels';
import { cn } from '@/lib/cn';
import { Plus, Trash2, ChevronDown, ChevronRight, MoreHorizontal, Pencil, X, Check, Gauge, Flag } from 'lucide-react';
import type { ProjectView } from '@/domain/view';
import type { Task } from '@/domain/task';
import type { Project } from '@/domain/project';
import type { TaskBucket } from '@/domain/bucket';

const COLLAPSED_KEY = 'cria:kanbanCollapsed';

interface KanbanBoardProps {
  view: ProjectView;
  project: Project;
}

export function KanbanBoard({ view, project }: KanbanBoardProps) {
  const { columns, isLoading, isError, error } = useKanbanBoard(view, project);
  const queryClient = useQueryClient();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(`${COLLAPSED_KEY}:${view.localId}`);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleCollapse = (bucketLocalId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(bucketLocalId)) next.delete(bucketLocalId);
      else next.add(bucketLocalId);
      localStorage.setItem(`${COLLAPSED_KEY}:${view.localId}`, JSON.stringify([...next]));
      return next;
    });
  };

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !active) return;

    const taskId = String(active.id);
    // Find which column the task was dropped into
    const targetBucketId = findBucketForDroppable(String(over.id), columns);
    if (!targetBucketId) return;

    // Find the task's current bucket in the column data
    const sourceColumn = findSourceColumn(taskId, columns);
    const sourceBucketId = sourceColumn?.bucket.localId;
    if (sourceBucketId === targetBucketId) return;

    // Optimistically move the card in the cached board so it lands the
    // instant you drop, rather than waiting on the DB write + refetch
    // round-trip. setTaskBucket then persists; its notify('tasks')
    // refetch reconciles (idempotent — same assignment).
    queryClient.setQueryData(
      ['kanban-buckets', view.localId],
      (old: { buckets: unknown[]; assignments: TaskBucket[] } | undefined) => {
        if (!old) return old;
        const assignments = old.assignments.filter((a) => a.taskLocalId !== taskId);
        assignments.push({
          taskLocalId: taskId,
          viewLocalId: view.localId,
          bucketLocalId: targetBucketId,
        });
        return { ...old, assignments };
      },
    );

    try {
      await setTaskBucket(taskId, view.localId, targetBucketId);
    } catch (err) {
      console.error('[kanban] failed to set task bucket:', err);
      // Roll back the optimistic move by re-reading the DB.
      void queryClient.invalidateQueries({
        queryKey: ['kanban-buckets', view.localId],
      });
    }
  }, [columns, view.localId, queryClient]);

  if (!view || view.viewKind !== 'kanban') return null;

  if (isLoading) {
    return (
      <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-8">
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading board…</p>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-8">
        <p className="text-sm text-[var(--color-warning)]">
          Couldn't load board{error instanceof Error ? `: ${error.message}` : ''}.
        </p>
      </section>
    );
  }

  const activeTask = activeId ? findTaskInColumns(activeId, columns) : null;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 overflow-x-auto">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex h-full gap-4 px-6 py-4">
          {columns.map((col) => (
            <KanbanColumn
              key={col.bucket.localId}
              column={col}
              collapsed={collapsed.has(col.bucket.localId)}
              onToggleCollapse={() => handleCollapse(col.bucket.localId)}
              view={view}
              projectLocalId={view.projectLocalId}
            />
          ))}
          <AddBucketColumn viewLocalId={view.localId} />
        </div>
        <DragOverlay>
          {activeTask ? (
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 shadow-lg opacity-90 max-w-60">
              <p className="text-sm font-medium truncate">{activeTask.title}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

/* ─── Column ─── */

interface ColumnProps {
  column: KanbanColumn;
  collapsed: boolean;
  onToggleCollapse: () => void;
  view: ProjectView;
  projectLocalId: string;
}

function KanbanColumn({ column, collapsed, onToggleCollapse, view, projectLocalId }: ColumnProps) {
  const { bucket, tasks } = column;
  const viewLocalId = view.localId;
  const [showNewInput, setShowNewInput] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(bucket.title);
  const [showMenu, setShowMenu] = useState(false);
  const [showLimitInput, setShowLimitInput] = useState(false);
  const [limitDraft, setLimitDraft] = useState(String(bucket.limit || 0));
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const isDoneBucket =
    bucket.serverId != null && view.doneBucketServerId === bucket.serverId;
  const isDefaultBucket =
    bucket.serverId != null && view.defaultBucketServerId === bucket.serverId;
  const atLimit = bucket.limit > 0 && tasks.length >= bucket.limit;

  const { setNodeRef, isOver } = useDroppable({
    id: bucket.localId,
  });

  // Close menu on click outside
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  const handleAddTask = async () => {
    if (atLimit) return;
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    const parsed = parseQuickAdd(trimmed);
    try {
      const task = await createTask({
        title: parsed.title || trimmed,
        projectLocalId,
        dueDate: parsed.dueDate ?? undefined,
        priority: parsed.priority ?? undefined,
      });
      // Move task to this bucket
      if (task.localId) {
        await setTaskBucket(task.localId, viewLocalId, bucket.localId);
      }
      if (parsed.labelTitles.length > 0) {
        await applyLabelsByTitle(task.localId, parsed.labelTitles).catch(() => {});
      }
      setNewTitle('');
      setShowNewInput(false);
    } catch (err) {
      console.error('[kanban] failed to create task:', err);
    }
  };

  const handleDeleteBucket = async () => {
    try {
      await deleteBucket(bucket.localId);
    } catch (err) {
      console.error('[kanban] failed to delete bucket:', err);
    }
    setShowMenu(false);
  };

  const handleSetLimit = async () => {
    const n = Math.max(0, parseInt(limitDraft, 10) || 0);
    if (n !== bucket.limit) {
      try {
        await updateBucket(bucket.localId, { limit: n });
      } catch (err) {
        console.error('[kanban] failed to set bucket limit:', err);
      }
    }
    setShowLimitInput(false);
    setShowMenu(false);
  };

  // Done / default bucket are stored on the *view* (by bucket server id), so
  // an unsynced bucket (no server id yet) can't be set until it syncs.
  const toggleDoneBucket = async () => {
    if (bucket.serverId == null) return;
    try {
      await updateView(view.localId, {
        doneBucketServerId: isDoneBucket ? null : bucket.serverId,
      });
    } catch (err) {
      console.error('[kanban] failed to toggle done bucket:', err);
    }
    setShowMenu(false);
  };

  const toggleDefaultBucket = async () => {
    if (bucket.serverId == null) return;
    try {
      await updateView(view.localId, {
        defaultBucketServerId: isDefaultBucket ? null : bucket.serverId,
      });
    } catch (err) {
      console.error('[kanban] failed to toggle default bucket:', err);
    }
    setShowMenu(false);
  };

  const handleRenameSave = async () => {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== bucket.title) {
      try {
        await updateBucket(bucket.localId, { title: trimmed });
      } catch (err) {
        console.error('[kanban] failed to rename bucket:', err);
      }
    }
    setRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleRenameSave();
    else if (e.key === 'Escape') setRenaming(false);
  };

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full w-72 shrink-0 flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)]/5',
        isOver && 'ring-2 ring-[var(--color-primary)]',
      )}
    >
      {/* Bucket header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <button
            onClick={onToggleCollapse}
            className="cursor-pointer text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {renaming ? (
            <div className="flex items-center gap-1">
              <input
                ref={renameInputRef}
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => void handleRenameSave()}
                onKeyDown={handleRenameKeyDown}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
              />
            </div>
          ) : (
            <span className="truncate text-xs font-medium">{bucket.title}</span>
          )}
          {isDoneBucket ? (
            <Check className="h-3 w-3 shrink-0 text-[var(--color-primary)]" aria-label="Done bucket" />
          ) : null}
          {isDefaultBucket ? (
            <Flag className="h-3 w-3 shrink-0 text-[var(--color-primary)]" aria-label="Default bucket" />
          ) : null}
          <span
            className={cn(
              'ml-auto shrink-0 text-[10px] tabular-nums',
              atLimit
                ? 'font-medium text-[var(--color-warning)]'
                : 'text-[var(--color-muted-foreground)]',
            )}
          >
            {bucket.limit > 0 ? `${tasks.length}/${bucket.limit}` : tasks.length}
          </span>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="cursor-pointer rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/10"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {showMenu && (
            <div
              ref={menuRef}
              className="absolute right-0 top-6 z-10 w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] py-1 shadow-lg"
            >
              <button
                onClick={() => { setRenaming(true); setShowMenu(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--color-accent)]/10 cursor-pointer"
              >
                <Pencil className="h-3 w-3" /> Rename
              </button>

              {showLimitInput ? (
                <div className="flex items-center gap-1 px-3 py-1.5">
                  <Gauge className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]" />
                  <input
                    type="number"
                    min={0}
                    autoFocus
                    value={limitDraft}
                    onChange={(e) => setLimitDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void handleSetLimit(); }
                      else if (e.key === 'Escape') setShowLimitInput(false);
                    }}
                    className="w-14 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                  />
                  <button
                    onClick={() => void handleSetLimit()}
                    className="cursor-pointer rounded p-0.5 text-[var(--color-primary)]"
                    aria-label="Save limit"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setLimitDraft(String(bucket.limit || 0)); setShowLimitInput(true); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--color-accent)]/10 cursor-pointer"
                >
                  <Gauge className="h-3 w-3" /> {bucket.limit > 0 ? `Limit: ${bucket.limit}` : 'Set limit'}
                </button>
              )}

              <button
                onClick={toggleDoneBucket}
                disabled={bucket.serverId == null}
                title={bucket.serverId == null ? 'Sync the bucket first' : undefined}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--color-accent)]/10 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className={cn('h-3 w-3', isDoneBucket ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted-foreground)]')} />
                {isDoneBucket ? 'Done bucket ✓' : 'Set as done bucket'}
              </button>
              <button
                onClick={toggleDefaultBucket}
                disabled={bucket.serverId == null}
                title={bucket.serverId == null ? 'Sync the bucket first' : undefined}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--color-accent)]/10 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Flag className={cn('h-3 w-3', isDefaultBucket ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted-foreground)]')} />
                {isDefaultBucket ? 'Default bucket ✓' : 'Set as default bucket'}
              </button>

              <button
                onClick={handleDeleteBucket}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-warning)] hover:bg-[var(--color-accent)]/10 cursor-pointer"
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Task list */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {tasks.map((task) => (
              <KanbanCard key={task.localId} task={task} />
            ))}
            {tasks.length === 0 && (
              <p className="py-4 text-center text-[11px] text-[var(--color-muted-foreground)]">
                No tasks
              </p>
            )}
          </div>

          {/* Add task input */}
          <div className="border-t border-[var(--color-border)] px-2 py-2">
            {atLimit ? (
              <p className="px-2 py-1 text-center text-[11px] text-[var(--color-muted-foreground)]">
                Bucket full ({tasks.length}/{bucket.limit})
              </p>
            ) : showNewInput ? (
              <div className="flex items-center gap-1">
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void handleAddTask(); }
                    else if (e.key === 'Escape') { setShowNewInput(false); setNewTitle(''); }
                  }}
                  placeholder="Add a task…"
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-xs placeholder-[var(--color-muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
                />
                <button
                  onClick={() => { setShowNewInput(false); setNewTitle(''); }}
                  className="cursor-pointer rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => void handleAddTask()}
                  className="cursor-pointer rounded p-0.5 text-[var(--color-primary)] hover:text-[var(--color-primary)]/80"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewInput(true)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-foreground)] cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Add task
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Card ─── */

interface CardProps {
  task: Task;
}

function KanbanCard({ task }: CardProps) {
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  // Plain draggable (not sortable): cards are not themselves drop targets,
  // so the only droppables are the bucket columns — `over.id` in
  // onDragEnd is therefore always a bucket id, which makes cross-bucket
  // moves unambiguous. The floating card is rendered via <DragOverlay>;
  // the original is just dimmed while dragging.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.localId,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => setSelectedTask(task.localId)}
      className={cn(
        'group mb-2 cursor-grab rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm transition-shadow hover:shadow-sm active:cursor-grabbing',
        task.done && 'opacity-60',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 flex-1 truncate text-xs">{task.title}</p>
      </div>
      {task.priority > 0 || task.dueDate ? (
        <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--color-muted-foreground)]">
          {task.priority > 0 ? (
            <span>{'!'.repeat(Math.min(5, task.priority))}</span>
          ) : null}
          {task.dueDate ? (
            <span>{formatShortDate(task.dueDate)}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ─── Add bucket column ─── */

function AddBucketColumn({ viewLocalId }: { viewLocalId: string }) {
  const [showInput, setShowInput] = useState(false);
  const [title, setTitle] = useState('');

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await createBucket({ title: trimmed, viewLocalId });
      setTitle('');
      setShowInput(false);
    } catch (err) {
      console.error('[kanban] failed to create bucket:', err);
    }
  };

  if (showInput) {
    return (
      <div className="flex h-fit w-72 shrink-0 flex-col gap-2 rounded-lg border border-dashed border-[var(--color-border)] p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void handleCreate(); }
            else if (e.key === 'Escape') { setShowInput(false); setTitle(''); }
          }}
          placeholder="Bucket name…"
          autoFocus
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-xs placeholder-[var(--color-muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleCreate()}
            className="rounded bg-[var(--color-primary)] px-3 py-1 text-xs text-white cursor-pointer hover:opacity-90"
          >
            Add
          </button>
          <button
            onClick={() => { setShowInput(false); setTitle(''); }}
            className="cursor-pointer text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowInput(true)}
      className="flex h-fit w-72 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-muted-foreground)] hover:border-solid hover:text-[var(--color-foreground)]"
    >
      <Plus className="h-4 w-4" />
      Add Column
    </button>
  );
}

/* ─── Helpers ─── */

function findBucketForDroppable(
  overId: string,
  columns: KanbanColumn[],
): string | null {
  // If the over is a bucket, return it
  if (columns.some((c) => c.bucket.localId === overId)) return overId;
  // If the over is a task, find its bucket
  for (const col of columns) {
    if (col.tasks.some((t) => t.localId === overId)) return col.bucket.localId;
  }
  return null;
}

function findSourceColumn(
  taskId: string,
  columns: KanbanColumn[],
): KanbanColumn | undefined {
  return columns.find((col) => col.tasks.some((t) => t.localId === taskId));
}

function findTaskInColumns(
  taskId: string,
  columns: KanbanColumn[],
): Task | undefined {
  for (const col of columns) {
    const t = col.tasks.find((t) => t.localId === taskId);
    if (t) return t;
  }
  return undefined;
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
