import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { useKanbanBoard, type KanbanColumn } from '@/queries/kanban';
import { toCalendarDate } from '@/lib/dateFormat';
import { priorityColor } from '@/components/ui/priority-select';
import { useProjectTaskLabels } from '@/queries/taskLabels';
import { KanbanFilterPopup } from './KanbanFilterPopup';
import {
  type BoardFilter,
  isBoardFilterActive,
  taskMatchesBoardFilter,
  loadBoardFilter,
  saveBoardFilter,
} from './boardFilter';
import { createTask } from '@/db/tasks';
import { setTaskBucket, reorderTasksInBucket, createBucket, deleteBucket, updateBucket } from '@/db/buckets';
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
const EMPTY_LABEL_MAP: Map<string, string[]> = new Map();

interface KanbanBoardProps {
  view: ProjectView;
  project: Project;
}

export function KanbanBoard({ view, project }: KanbanBoardProps) {
  const { columns: rawColumns, isLoading, isError, error } = useKanbanBoard(view, project);
  const { data: labelMap = EMPTY_LABEL_MAP } = useProjectTaskLabels(view.projectLocalId);
  const queryClient = useQueryClient();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<BoardFilter>(() => loadBoardFilter(view.localId));
  const updateFilter = useCallback(
    (next: BoardFilter) => {
      setFilter(next);
      saveBoardFilter(view.localId, next);
    },
    [view.localId],
  );

  const columns = useMemo(() => {
    if (!isBoardFilterActive(filter)) return rawColumns;
    return rawColumns.map((c) => ({
      ...c,
      tasks: c.tasks.filter((t) =>
        taskMatchesBoardFilter(t, filter, labelMap.get(t.localId) ?? []),
      ),
    }));
  }, [rawColumns, filter, labelMap]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(`${COLLAPSED_KEY}:${view.localId}`);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    // Touch: long-press to grab a card so the board can still be scrolled.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
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
    const overId = String(over.id);

    const sourceCol = findSourceColumn(taskId, columns);
    if (!sourceCol) return;

    let targetCol = columns.find((c) => c.bucket.localId === overId);
    if (!targetCol) {
      targetCol = columns.find((c) => c.tasks.some((t) => t.localId === overId));
    }
    if (!targetCol) return;

    const sourceBucketId = sourceCol.bucket.localId;
    const targetBucketId = targetCol.bucket.localId;
    const targetTasks = targetCol.tasks.map((t) => t.localId);

    // Optimistically reorder the target bucket's assignments *positionally*
    // (buildKanbanColumns preserves assignment array order), so the card stays
    // where it was dropped regardless of whether positions are still colliding.
    const applyOptimistic = (orderedIds: string[]) =>
      queryClient.setQueryData(
        ['kanban-buckets', view.localId],
        (old: { buckets: unknown[]; assignments: TaskBucket[] } | undefined) =>
          old
            ? { ...old, assignments: applyBucketOrder(old.assignments, view.localId, targetBucketId, orderedIds) }
            : old,
      );

    // Kanban tasks often have no `task_buckets` row (they're shown via the
    // "unplaced → default bucket" fallback), so a single midpoint UPDATE would
    // match no row and the card would snap back. Re-index the whole target
    // bucket instead — it upserts a row + clean position for every card. The
    // buckets are small, so the extra writes are cheap.
    if (sourceBucketId === targetBucketId) {
      // Intra-bucket reorder
      const oldIdx = targetTasks.indexOf(taskId);
      const newIdx = targetTasks.indexOf(overId);
      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;

      const orderedIds = arrayMove(targetTasks, oldIdx, newIdx);
      applyOptimistic(orderedIds);

      try {
        await reorderTasksInBucket(view.localId, targetBucketId, orderedIds);
      } catch (err) {
        console.error('[kanban] failed to reorder tasks in bucket:', err);
        void queryClient.invalidateQueries({ queryKey: ['kanban-buckets', view.localId] });
      }
    } else {
      // Cross-bucket move
      let insertIdx = overId === targetBucketId
        ? targetTasks.length
        : targetTasks.indexOf(overId);
      if (insertIdx < 0) insertIdx = targetTasks.length;

      const orderedIds = [...targetTasks];
      orderedIds.splice(insertIdx, 0, taskId);
      applyOptimistic(orderedIds);

      try {
        // Record the bucket change (its own outbox entry for server sync),
        // then re-index the target bucket so the moved card and its new
        // neighbours all get clean, ordered positions.
        await setTaskBucket(taskId, view.localId, targetBucketId);
        await reorderTasksInBucket(view.localId, targetBucketId, orderedIds);
      } catch (err) {
        console.error('[kanban] failed to move task to bucket:', err);
        void queryClient.invalidateQueries({ queryKey: ['kanban-buckets', view.localId] });
      }
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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-end border-b border-[var(--color-border)] px-6 py-1.5">
        <KanbanFilterPopup filter={filter} onChange={updateFilter} />
      </div>
      <div className="flex min-h-0 flex-1 overflow-x-auto">
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
      </div>
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

  const taskIds = useMemo(() => tasks.map((t) => t.localId), [tasks]);

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
    // WIP limits are advisory: the column highlights when over the limit
    // (see the count indicator) but never blocks adding — matching drag,
    // where over-limit drops are already allowed.
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
              'ml-auto shrink-0 text-footnote tabular-nums',
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
            <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
              {tasks.map((task) => (
                <KanbanCard key={task.localId} task={task} />
              ))}
            </SortableContext>
            {tasks.length === 0 && (
              <p className="py-4 text-center text-caption text-[var(--color-muted-foreground)]">
                No tasks
              </p>
            )}
          </div>

          {/* Add task input — always available; the WIP limit is advisory
              (shown via the highlighted count) and never blocks adding. */}
          <div className="border-t border-[var(--color-border)] px-2 py-2">
            {showNewInput ? (
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

const KanbanCard = memo(function KanbanCard({ task }: CardProps) {
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.localId,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
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
        <div className="mt-1 flex items-center gap-2 text-footnote text-[var(--color-muted-foreground)]">
          {task.priority > 0 ? (
            <span style={{ color: priorityColor(task.priority) }}>{'!'.repeat(Math.min(5, task.priority))}</span>
          ) : null}
          {task.dueDate ? (
            <span>{formatShortDate(task.dueDate)}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

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

/**
 * Optimistically rewrite the kanban assignments so the target bucket's cards
 * follow `orderedTaskIds` exactly. buildKanbanColumns derives each column's
 * order from the assignment array order (not the numeric position), so a
 * positional rewrite reflects the drop immediately in SortableContext — even
 * when positions are still colliding (all 0) before the DB re-index lands.
 *
 * Any prior assignment for the moved/target tasks in this view is dropped and
 * re-added under `targetBucketId`, so a cross-bucket move also clears the card
 * from its old column. Index-based positions keep the optimistic entries
 * self-consistent until the refetch replaces them with the persisted spread.
 */
function applyBucketOrder(
  assignments: TaskBucket[],
  viewLocalId: string,
  targetBucketId: string,
  orderedTaskIds: string[],
): TaskBucket[] {
  const moving = new Set(orderedTaskIds);
  const rest = assignments.filter(
    (a) => !(a.viewLocalId === viewLocalId && moving.has(a.taskLocalId)),
  );
  const reordered: TaskBucket[] = orderedTaskIds.map((taskLocalId, i) => ({
    taskLocalId,
    viewLocalId,
    bucketLocalId: targetBucketId,
    position: (i + 1) * 1024,
  }));
  return [...rest, ...reordered];
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
    const d = toCalendarDate(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
