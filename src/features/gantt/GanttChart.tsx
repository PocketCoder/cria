import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  visibleGanttNodes,
  buildParentMap,
  resolveVisibleAnchor,
  dayToIso,
  type GanttTaskNode,
} from './buildGanttTaskTree';
import { DAY_WIDTH_PIXELS, ROW_HEIGHT, HEADER_HEIGHT } from './constants';
import type { GanttFilters } from './useGanttFilters';
import { GanttRelationArrows, type BarGeometry, type ArrowAnchor } from './GanttRelationArrows';
import type { GanttRelationEdge } from '@/db/relations';
import {
  buildMonthGroups,
  computeDayRange,
  computePlacements,
  nudgeBar,
  normalizeColor,
  resolveBarDays,
  type DragMode,
} from './ganttGeometry';
import { useGanttReorder } from './useGanttReorder';
import { useGanttBarDrag } from './useGanttBarDrag';
import { GanttRailRow } from './GanttRailRow';
import { GanttBar, GanttGrid, GanttTimelineHeader } from './GanttTimelineParts';

interface GanttChartProps {
  nodes: GanttTaskNode[];
  relations: GanttRelationEdge[];
  filters: GanttFilters;
  projectColor: string | null;
  /** View the chart belongs to; reorder writes its id into the position
   *  outbox entry. Drag-reorder is disabled when absent. */
  viewLocalId?: string;
  /** Project the tasks belong to; used to optimistically reorder the task
   *  cache so a drag-reorder survives a slow refetch. */
  projectLocalId?: string;
  onUpdateDates: (taskLocalId: string, startIso: string, endIso: string) => void;
  onOpenTask: (taskLocalId: string) => void;
}

export function GanttChart({
  nodes,
  relations,
  filters,
  projectColor,
  viewLocalId,
  projectLocalId,
  onUpdateDates,
  onOpenTask,
}: GanttChartProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { sortableItems, orderedNodes, reorderSensors, handleReorderEnd } = useGanttReorder(
    nodes,
    viewLocalId,
    projectLocalId,
  );
  const { drag, startDrag } = useGanttBarDrag({ onUpdateDates, onOpenTask });

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const { today, lo, hi, totalDays } = computeDayRange(
    filters.dateFrom,
    filters.dateTo,
    Date.now(),
  );
  const range = { today, lo, hi };
  const chartWidth = totalDays * DAY_WIDTH_PIXELS;

  const visible = useMemo(
    () => visibleGanttNodes(orderedNodes, collapsed, filters.showTasksWithoutDates),
    [orderedNodes, collapsed, filters.showTasksWithoutDates],
  );
  const parentMap = useMemo(() => buildParentMap(orderedNodes), [orderedNodes]);
  const bodyHeight = visible.length * ROW_HEIGHT;

  const handleStartDrag = (node: GanttTaskNode, mode: DragMode, e: React.PointerEvent) => {
    const r = resolveBarDays(node, range);
    startDrag(node.task.localId, mode, e, r.start, r.end);
  };

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const syncScroll = (from: HTMLDivElement, to: HTMLDivElement) => {
    if (syncing.current) {
      syncing.current = false;
      return;
    }
    syncing.current = true;
    to.scrollTop = from.scrollTop;
  };

  // Header cells.
  const monthGroups = useMemo(() => buildMonthGroups(lo, totalDays), [lo, totalDays]);

  // Keyboard nudging on a focused bar: ←/→ move a day, Shift+←/→ resize the
  // end, Ctrl/⌘+←/→ resize the start. Skipped for dateless placeholders.
  const handleKeyNudge = (node: GanttTaskNode, e: React.KeyboardEvent) => {
    const r = resolveBarDays(node, range);
    const next = nudgeBar(r, e.key, e);
    if (!next) return;
    e.preventDefault();
    if (next.start !== r.start || next.end !== r.end) {
      onUpdateDates(node.task.localId, dayToIso(next.start), dayToIso(next.end));
    }
  };

  // Centre the initial scroll position on today, once per mount.
  const centered = useRef(false);
  useEffect(() => {
    if (centered.current) return;
    const el = rightRef.current;
    if (!el || !el.clientWidth) return;
    centered.current = true;
    const todayLeft = (today - lo) * DAY_WIDTH_PIXELS;
    el.scrollLeft = Math.max(0, todayLeft - el.clientWidth / 2 + DAY_WIDTH_PIXELS / 2);
  });

  const todayInRange = today >= lo && today <= hi;
  const baseColor = normalizeColor(projectColor) ?? 'var(--color-primary)';

  // Resolve each visible row's bar geometry once, so the bars and the
  // relation-arrow overlay share the same coordinates (and arrows follow a
  // bar while it's being dragged).
  const placements = computePlacements(visible, range, drag, chartWidth, baseColor);

  const geometry = new Map<string, BarGeometry>();
  for (const p of placements) {
    geometry.set(p.node.task.localId, {
      left: p.left,
      right: p.left + p.width,
      cy: p.top + p.height / 2,
    });
  }

  // Anchor a relation endpoint: itself if visible, else its nearest collapsed
  // ancestor (so arrows point at a collapsed group instead of vanishing).
  const visibleIds = new Set(geometry.keys());
  const resolveAnchor = (localId: string): ArrowAnchor | null => {
    const anchorId = resolveVisibleAnchor(localId, visibleIds, parentMap, collapsed);
    const geom = anchorId ? geometry.get(anchorId) : undefined;
    return geom && anchorId ? { id: anchorId, geom } : null;
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Frozen task-name pane */}
      <div
        ref={leftRef}
        onScroll={() =>
          leftRef.current && rightRef.current && syncScroll(leftRef.current, rightRef.current)
        }
        className="w-64 shrink-0 overflow-y-auto border-r border-[var(--color-border)]"
      >
        <div
          style={{ height: HEADER_HEIGHT }}
          className="sticky top-0 z-10 flex items-end border-b border-[var(--color-border)] bg-[var(--color-background)] px-3 pb-1 text-caption font-medium text-[var(--color-muted-foreground)]"
        >
          Task
        </div>
        <DndContext sensors={reorderSensors} onDragEnd={handleReorderEnd}>
          <SortableContext items={sortableItems} strategy={verticalListSortingStrategy}>
            {visible.map((node) => (
              <GanttRailRow
                key={node.task.localId}
                node={node}
                collapsed={collapsed.has(node.task.localId)}
                onToggleCollapse={toggleCollapse}
                onOpenTask={onOpenTask}
                // Only top-level rows reorder; their subtrees ride along.
                sortable={node.indentLevel === 0 && !!viewLocalId}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* Scrollable timeline */}
      <div
        ref={rightRef}
        onScroll={() =>
          leftRef.current && rightRef.current && syncScroll(rightRef.current, leftRef.current)
        }
        className="min-w-0 flex-1 overflow-auto"
      >
        <div style={{ width: chartWidth }} className="relative">
          <GanttTimelineHeader
            monthGroups={monthGroups}
            lo={lo}
            totalDays={totalDays}
            today={today}
          />

          {/* Body: grid + today + bars */}
          <div className="relative" style={{ height: bodyHeight }}>
            <GanttGrid lo={lo} totalDays={totalDays} today={today} todayInRange={todayInRange} />

            {/* Dependency arrows sit under the bars so bar drags stay hittable. */}
            <GanttRelationArrows
              relations={relations}
              resolve={resolveAnchor}
              width={chartWidth}
              height={bodyHeight}
            />

            {placements.map((placement) => (
              <GanttBar
                key={placement.node.task.localId}
                placement={placement}
                drag={drag}
                onStartDrag={handleStartDrag}
                onKeyNudge={handleKeyNudge}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
