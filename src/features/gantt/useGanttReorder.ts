import { useCallback, useMemo } from 'react';
import {
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { useOptimisticOrder } from '@/lib/useOptimisticOrder';
import { reorderTask, reindexTasks } from '@/db/tasks';
import { planReorder } from '@/lib/position';
import { setProjectTaskOrder } from '@/queries/tasks';
import { reorderRootBlocks, type GanttTaskNode } from './buildGanttTaskTree';

/**
 * Optimistic root order for drag-reorder. Only top-level rows reorder; their
 * subtrees ride along. Driving the rendered order from this state keeps both
 * panes in sync and avoids snap-back until the query refetch confirms the new
 * positions. Mirrors the list view.
 */
export function useGanttReorder(
  nodes: GanttTaskNode[],
  viewLocalId: string | undefined,
  projectLocalId: string | undefined,
) {
  const queryClient = useQueryClient();
  const rootOrder = useMemo(
    () => nodes.filter((n) => n.indentLevel === 0).map((n) => n.task.localId),
    [nodes],
  );
  const [sortableItems, setSortableItems] = useOptimisticOrder(rootOrder);

  const orderedNodes = useMemo(
    () => reorderRootBlocks(nodes, sortableItems),
    [nodes, sortableItems],
  );

  const reorderSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const handleReorderEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !viewLocalId) return;
      const activeRoot = String(active.id);
      const overRoot = String(over.id);
      if (activeRoot === overRoot) return;

      const oldIdx = sortableItems.indexOf(activeRoot);
      const newIdx = sortableItems.indexOf(overRoot);
      if (oldIdx === -1 || newIdx === -1) return;

      const orderedIds = arrayMove(sortableItems, oldIdx, newIdx);
      setSortableItems(orderedIds);

      // Optimistically reorder the task cache to the new display order too, so
      // the rows hold their new positions even if the position write's refetch
      // (which may do a slow network pull) lands after a faster local refetch
      // of subtasks/relations would otherwise re-derive the old order.
      if (projectLocalId) {
        const displayOrder = reorderRootBlocks(nodes, orderedIds).map((n) => n.task.localId);
        setProjectTaskOrder(queryClient, projectLocalId, displayOrder);
      }

      const positionOf = (id: string) =>
        nodes.find((n) => n.task.localId === id)?.task.position ?? null;
      const plan = planReorder(orderedIds, activeRoot, positionOf);
      try {
        if (plan.type === 'midpoint') {
          await reorderTask(activeRoot, viewLocalId, plan.position);
        } else {
          await reindexTasks(orderedIds, viewLocalId);
        }
      } catch (err) {
        console.error('[gantt] failed to reorder task:', err);
      }
    },
    [viewLocalId, projectLocalId, sortableItems, setSortableItems, nodes, queryClient],
  );

  return { sortableItems, orderedNodes, reorderSensors, handleReorderEnd };
}
