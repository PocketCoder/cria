import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { updateTask, reorderTask, reindexTasks } from '@/db/tasks';
import { planReorder } from '@/lib/position';
import { useOptimisticOrder } from '@/lib/useOptimisticOrder';
import { orderTasksByIds } from '@/lib/taskOrder';
import { setProjectTaskOrder } from '@/queries/tasks';
import type { Task } from '@/domain/task';
import type { ProjectView } from '@/domain/view';
import type { Project } from '@/domain/project';
import { sortTasks, type SortState, type VisibleState } from './useTableConfig';
import { cleanDraft, type DraftFields } from './tableLogic';

/**
 * Table-wide edit mode: a single toggle turns every editable cell into an
 * input. Edits accumulate in `drafts` (keyed by task) and are written on
 * Save — or auto-saved when leaving the table (view/project switch, unmount).
 */
export function useTableDrafts(projectLocalId: string) {
  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftFields>>({});
  const draftsRef = useRef(drafts);
  useLayoutEffect(() => {
    draftsRef.current = drafts;
  });

  const flush = useCallback((pending: Record<string, DraftFields>) => {
    for (const [localId, patch] of Object.entries(pending)) {
      if (!patch) continue;
      const clean = cleanDraft(patch);
      if (Object.keys(clean).length > 0) {
        void updateTask(localId, clean).catch((err) =>
          console.error('[table] failed to save edit:', err),
        );
      }
    }
  }, []);

  const setDraft = useCallback(
    (localId: string, field: keyof DraftFields, value: unknown) => {
      setDrafts((prev) => ({
        ...prev,
        [localId]: { ...prev[localId], [field]: value } as DraftFields,
      }));
    },
    [],
  );

  const saveAndExit = useCallback(() => {
    flush(draftsRef.current);
    setDrafts({});
    setEditMode(false);
  }, [flush]);

  // Leaving the table (project switch or unmount) flushes pending drafts and
  // resets edit state, so nothing is silently lost.
  useEffect(() => {
    setDrafts({});
    setEditMode(false);
    return () => {
      flush(draftsRef.current);
    };
  }, [projectLocalId, flush]);

  return { editMode, setEditMode, drafts, setDraft, saveAndExit };
}

/**
 * Drag-reorder. dnd-kit's SortableContext must see the row order change
 * synchronously on drop, otherwise it reverts the CSS transform (snap-back).
 * We keep an optimistic id array, update it directly in handleDragEnd, AND
 * drive the rendered rows from it (see `orderedRows`) so the DOM and the
 * SortableContext never disagree about where a row sits. The override is
 * dropped whenever the sorted query result changes.
 */
export function useTableReorder({
  sorted,
  view,
  projectLocalId,
  clearSort,
}: {
  sorted: Task[];
  view: ProjectView | undefined;
  projectLocalId: string;
  clearSort: () => void;
}) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const sortedIds = useMemo(() => sorted.map((t) => t.localId), [sorted]);
  const [sortableItems, setSortableItems] = useOptimisticOrder(sortedIds);

  // Render rows in `sortableItems` order so an optimistic reorder shows up in
  // the same commit that updates the SortableContext — the row stays where it
  // was dropped instead of snapping back to the query order.
  const orderedRows = useMemo(
    () => orderTasksByIds(sorted, sortableItems),
    [sorted, sortableItems],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || !active || !view) return;

      const taskId = String(active.id);
      const overId = String(over.id);
      if (taskId === overId) return;

      // Reorder within the rows the user actually sees (`orderedRows`), so the
      // dragged/over ids resolve against the displayed order — not a stale
      // query order that a pending optimistic reorder hasn't caught up to.
      const oldIdx = orderedRows.findIndex((t) => t.localId === taskId);
      const newIdx = orderedRows.findIndex((t) => t.localId === overId);
      if (oldIdx === -1 || newIdx === -1) return;

      const reordered = arrayMove(orderedRows, oldIdx, newIdx);
      const orderedIds = reordered.map((t) => t.localId);

      // A drag means "I want manual order". Drop any active column sort —
      // otherwise the refetch would re-sort by that column and snap the row
      // back, since reorder only writes `position` (manual order is the
      // no-active-sort case, which renders in position order). Then mirror
      // the new order into the optimistic state AND the task cache so the
      // displayed order is consistent from the drop through the refetch.
      setSortableItems(orderedIds);
      clearSort();
      setProjectTaskOrder(qc, projectLocalId, orderedIds);

      // Midpoint only works when the neighbours have distinct, non-null
      // positions. Locally-created tasks start at position=null, so the first
      // reorder (or a collision) re-indexes the whole list to lay down a clean
      // spread; steady state stays on the cheap single write.
      const positions = new Map(reordered.map((t) => [t.localId, t.position]));
      const plan = planReorder(orderedIds, taskId, (id) => positions.get(id));
      try {
        if (plan.type === 'midpoint') {
          await reorderTask(taskId, view.localId, plan.position);
        } else {
          await reindexTasks(orderedIds, view.localId);
        }
      } catch (err) {
        console.error('[table] failed to reorder task:', err);
        setReorderError(true);
      }
    },
    [view, orderedRows, setSortableItems, clearSort, qc, projectLocalId],
  );

  return {
    activeId,
    reorderError,
    setReorderError,
    sensors,
    sortableItems,
    orderedRows,
    handleDragStart,
    handleDragEnd,
  };
}

/** `localId → title` lookup for the project column and project sort. */
export function useProjectTitleLookup(allProjects: Project[]) {
  return useMemo(() => {
    const map = new Map(allProjects.map((p) => [p.localId, p.title]));
    return (id: string) => map.get(id) ?? '';
  }, [allProjects]);
}

/** Active / completed split of the visible tasks, each sorted by the column sort. */
export function useTableTasks({
  tasks,
  pendingDeletes,
  sortBy,
  projectTitle,
  visible,
}: {
  tasks: Task[];
  pendingDeletes: Record<string, unknown>;
  sortBy: SortState;
  projectTitle: (id: string) => string;
  visible: VisibleState;
}) {
  const visibleTasks = useMemo(
    () => tasks.filter((t) => !pendingDeletes[t.localId]),
    [tasks, pendingDeletes],
  );
  const activeTasks = useMemo(() => visibleTasks.filter((t) => !t.done), [visibleTasks]);
  const completedTasks = useMemo(() => visibleTasks.filter((t) => t.done), [visibleTasks]);

  const sorted = useMemo(
    () => sortTasks(activeTasks, sortBy, { projectTitle, visible }),
    [activeTasks, sortBy, projectTitle, visible],
  );
  const sortedCompleted = useMemo(
    () => sortTasks(completedTasks, sortBy, { projectTitle, visible }),
    [completedTasks, sortBy, projectTitle, visible],
  );
  return { activeTasks, completedTasks, sorted, sortedCompleted };
}
