import { useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { useKanbanBoard } from '@/queries/kanban';
import { useProjectTaskLabels } from '@/queries/taskLabels';
import { KanbanFilterPopup } from './KanbanFilterPopup';
import {
  type BoardFilter,
  isBoardFilterActive,
  taskMatchesBoardFilter,
  loadBoardFilter,
  saveBoardFilter,
} from './boardFilter';
import { setTaskBucket, reorderTasksInBucket } from '@/db/buckets';
import type { ProjectView } from '@/domain/view';
import type { Project } from '@/domain/project';
import type { TaskBucket } from '@/domain/bucket';
import { KanbanColumn } from './KanbanColumn';
import { AddBucketColumn } from './AddBucketColumn';
import { applyBucketOrder, findSourceColumn, findTaskInColumns } from './kanbanLogic';

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

  // Filter-mode boards derive their columns from filters, so cards can't be
  // dragged between them (there is no bucket to move into).
  const readOnly = view.bucketConfigurationMode === 'filter';
  const noSensors = useSensors();
  const dragSensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    // Touch: long-press to grab a card so the board can still be scrolled.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );
  const sensors = readOnly ? noSensors : dragSensors;

  const handleCollapse = (bucketLocalId: string) => {
    const next = new Set(collapsed);
    if (next.has(bucketLocalId)) next.delete(bucketLocalId);
    else next.add(bucketLocalId);
    localStorage.setItem(`${COLLAPSED_KEY}:${view.localId}`, JSON.stringify([...next]));
    setCollapsed(next);
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
        <p className="text-sm text-[var(--color-warning-text)]">
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
                readOnly={readOnly}
              />
            ))}
            {!readOnly && <AddBucketColumn viewLocalId={view.localId} />}
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
