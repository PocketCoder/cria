import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  DndContext,
  useSensor,
  useSensors,
  PointerSensor,
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
import { cn } from '@/lib/cn';
import { reorderTask, reindexTasks } from '@/db/tasks';
import { planReorder } from '@/lib/position';
import type { Task } from '@/domain/task';
import {
  visibleGanttNodes,
  buildParentMap,
  resolveVisibleAnchor,
  reorderRootBlocks,
  dayToIso,
  dayToUtcDate,
  type GanttTaskNode,
} from './buildGanttTaskTree';
import {
  DAY_WIDTH_PIXELS,
  ROW_HEIGHT,
  HEADER_HEIGHT,
  DRAG_THRESHOLD_PIXELS,
  DEFAULT_SPAN_DAYS,
} from './constants';
import type { GanttFilters } from './useGanttFilters';
import { GanttRelationArrows, type BarGeometry, type ArrowAnchor } from './GanttRelationArrows';
import type { GanttRelationEdge } from '@/db/relations';

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

type DragMode = 'move' | 'resize-start' | 'resize-end';

interface DragState {
  taskLocalId: string;
  mode: DragMode;
  startClientX: number;
  origStart: number;
  origEnd: number;
  deltaDays: number;
  moved: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function normalizeColor(hex: string | null): string | null {
  if (!hex) return null;
  const t = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}|[0-9a-f]{6}$/i.test(t)) return null;
  return `#${t}`;
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
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);

  // Optimistic root order for drag-reorder. Only top-level rows reorder;
  // their subtrees ride along. Driving the rendered order from this state
  // (see `orderedNodes`) keeps both panes in sync and avoids snap-back until
  // the query refetch confirms the new positions. Mirrors the list view.
  const rootOrder = useMemo(
    () => nodes.filter((n) => n.indentLevel === 0).map((n) => n.task.localId),
    [nodes],
  );
  const [sortableItems, setSortableItems] = useState<string[]>(rootOrder);
  useEffect(() => {
    setSortableItems((prev) => {
      if (prev.length === rootOrder.length && prev.every((id, i) => id === rootOrder[i])) {
        return prev;
      }
      return rootOrder;
    });
  }, [rootOrder]);

  const orderedNodes = useMemo(
    () => reorderRootBlocks(nodes, sortableItems),
    [nodes, sortableItems],
  );

  const reorderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
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
        queryClient.setQueryData<Task[]>(['tasks', projectLocalId], (old) =>
          old ? reorderTasksByIds(old, displayOrder) : old,
        );
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
    [viewLocalId, projectLocalId, sortableItems, nodes, queryClient],
  );

  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const cbRef = useRef({ onUpdateDates, onOpenTask });
  cbRef.current = { onUpdateDates, onOpenTask };

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const today = Math.floor(Date.now() / 86400000);
  const rawFrom = Math.floor(Date.parse(filters.dateFrom) / 86400000);
  const rawTo = Math.floor(Date.parse(filters.dateTo) / 86400000);
  const lo = Math.min(rawFrom, rawTo);
  const hi = Math.max(rawFrom, rawTo);
  const totalDays = hi - lo + 1;
  const chartWidth = totalDays * DAY_WIDTH_PIXELS;

  const visible = useMemo(
    () => visibleGanttNodes(orderedNodes, collapsed, filters.showTasksWithoutDates),
    [orderedNodes, collapsed, filters.showTasksWithoutDates],
  );
  const parentMap = useMemo(() => buildParentMap(orderedNodes), [orderedNodes]);
  const bodyHeight = visible.length * ROW_HEIGHT;

  /** Resolve a node's drawn day-range, filling partial / dateless bars. */
  const resolveBarDays = useCallback(
    (node: GanttTaskNode): { start: number; end: number; dateless: boolean } => {
      let s = node.startDay;
      let e = node.endDay;
      if (s === null && e === null) {
        const anchor = Math.min(Math.max(today, lo), hi);
        return { start: anchor, end: anchor + DEFAULT_SPAN_DAYS - 1, dateless: true };
      }
      if (s !== null && e === null) e = s + DEFAULT_SPAN_DAYS - 1;
      if (e !== null && s === null) s = e - DEFAULT_SPAN_DAYS + 1;
      return { start: s!, end: e!, dateless: false };
    },
    [today, lo, hi],
  );

  function applyDrag(d: DragState): { start: number; end: number } {
    if (d.mode === 'move') {
      return { start: d.origStart + d.deltaDays, end: d.origEnd + d.deltaDays };
    }
    if (d.mode === 'resize-start') {
      return { start: Math.min(d.origStart + d.deltaDays, d.origEnd), end: d.origEnd };
    }
    return { start: d.origStart, end: Math.max(d.origEnd + d.deltaDays, d.origStart) };
  }

  const startDrag = (node: GanttTaskNode, mode: DragMode, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const r = resolveBarDays(node);
    setDrag({
      taskLocalId: node.task.localId,
      mode,
      startClientX: e.clientX,
      origStart: r.start,
      origEnd: r.end,
      deltaDays: 0,
      moved: false,
    });
  };

  // Global pointer listeners live only while a drag is active.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaPx = e.clientX - d.startClientX;
      setDrag({
        ...d,
        deltaDays: Math.round(deltaPx / DAY_WIDTH_PIXELS),
        moved: d.moved || Math.abs(deltaPx) > DRAG_THRESHOLD_PIXELS,
      });
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d) {
        if (d.moved) {
          const { start, end } = applyDrag(d);
          if (start !== d.origStart || end !== d.origEnd) {
            cbRef.current.onUpdateDates(d.taskLocalId, dayToIso(start), dayToIso(end));
          }
        } else {
          cbRef.current.onOpenTask(d.taskLocalId);
        }
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const monthGroups = useMemo(() => {
    const groups: { label: string; left: number; width: number }[] = [];
    let i = 0;
    while (i < totalDays) {
      const d = dayToUtcDate(lo + i);
      const ym = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      let span = 0;
      while (
        i + span < totalDays &&
        (() => {
          const dd = dayToUtcDate(lo + i + span);
          return `${dd.getUTCFullYear()}-${dd.getUTCMonth()}` === ym;
        })()
      ) {
        span++;
      }
      groups.push({
        label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
        left: i * DAY_WIDTH_PIXELS,
        width: span * DAY_WIDTH_PIXELS,
      });
      i += span;
    }
    return groups;
  }, [lo, totalDays]);

  // Keyboard nudging on a focused bar: ←/→ move a day, Shift+←/→ resize the
  // end, Ctrl/⌘+←/→ resize the start. Skipped for dateless placeholders.
  const handleKeyNudge = (node: GanttTaskNode, e: React.KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (dir === 0) return;
    const r = resolveBarDays(node);
    if (r.dateless) return;
    e.preventDefault();
    let ns = r.start;
    let ne = r.end;
    if (e.shiftKey) ne = Math.max(r.start, r.end + dir);
    else if (e.metaKey || e.ctrlKey) ns = Math.min(r.end, r.start + dir);
    else {
      ns = r.start + dir;
      ne = r.end + dir;
    }
    if (ns !== r.start || ne !== r.end) {
      onUpdateDates(node.task.localId, dayToIso(ns), dayToIso(ne));
    }
  };

  const todayInRange = today >= lo && today <= hi;
  const baseColor = normalizeColor(projectColor) ?? 'var(--color-primary)';

  // Resolve each visible row's bar geometry once, so the bars and the
  // relation-arrow overlay share the same coordinates (and arrows follow a
  // bar while it's being dragged).
  const placements = visible.map((node, index) => {
    const resolved = resolveBarDays(node);
    let s = resolved.start;
    let e = resolved.end;
    if (drag && drag.taskLocalId === node.task.localId) {
      const p = applyDrag(drag);
      s = p.start;
      e = p.end;
    }
    const rawX = (s - lo) * DAY_WIDTH_PIXELS;
    const rawW = (e - s + 1) * DAY_WIDTH_PIXELS;
    const left = Math.max(0, rawX);
    const right = Math.min(chartWidth, rawX + rawW);
    const width = Math.max(4, right - left);
    const top = index * ROW_HEIGHT + 8;
    const height = ROW_HEIGHT - 16;
    return {
      node,
      resolved,
      left,
      width,
      top,
      height,
      color: normalizeColor(node.task.hexColor) ?? baseColor,
      isPlaceholder: resolved.dateless || node.hasDerivedDates,
      label: `${dayToUtcDate(s).toISOString().slice(0, 10)} → ${dayToUtcDate(e)
        .toISOString()
        .slice(0, 10)}`,
    };
  });

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
          className="sticky top-0 z-10 flex items-end border-b border-[var(--color-border)] bg-[var(--color-background)] px-3 pb-1 text-[11px] font-medium text-[var(--color-muted-foreground)]"
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
          {/* Header: month groups + day columns */}
          <div
            style={{ height: HEADER_HEIGHT }}
            className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-background)]"
          >
            <div className="relative h-5 border-b border-[var(--color-border)]">
              {monthGroups.map((g) => (
                <div
                  key={g.left}
                  style={{ left: g.left, width: g.width }}
                  className="absolute truncate px-1 text-[11px] font-medium leading-5"
                >
                  {g.label}
                </div>
              ))}
            </div>
            <div className="relative" style={{ height: HEADER_HEIGHT - 21 }}>
              {Array.from({ length: totalDays }, (_, i) => {
                const d = dayToUtcDate(lo + i);
                const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
                const isToday = lo + i === today;
                return (
                  <div
                    key={i}
                    style={{ left: i * DAY_WIDTH_PIXELS, width: DAY_WIDTH_PIXELS }}
                    className={cn(
                      'absolute flex h-full flex-col items-center justify-center text-[10px] tabular-nums leading-none',
                      weekend && 'bg-[var(--color-muted)]/30',
                      isToday
                        ? 'font-semibold text-[var(--color-primary)]'
                        : 'text-[var(--color-muted-foreground)]',
                    )}
                  >
                    <span>{d.getUTCDate()}</span>
                    <span>{WEEKDAYS[d.getUTCDay()]}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Body: grid + today + bars */}
          <div className="relative" style={{ height: bodyHeight }}>
            {/* Day grid: explicit per-day cells (a repeating-gradient drops
                lines on fractional device pixels). Weekends shaded to match
                the header. */}
            <div className="pointer-events-none absolute inset-0">
              {Array.from({ length: totalDays }, (_, i) => {
                const wd = dayToUtcDate(lo + i).getUTCDay();
                const weekend = wd === 0 || wd === 6;
                return (
                  <div
                    key={i}
                    style={{ left: i * DAY_WIDTH_PIXELS, width: DAY_WIDTH_PIXELS }}
                    className={cn(
                      'absolute top-0 bottom-0 border-r border-[var(--color-border)]',
                      weekend && 'bg-[var(--color-muted)]/20',
                    )}
                  />
                );
              })}
            </div>

            {todayInRange ? (
              <div
                style={{ left: (today - lo) * DAY_WIDTH_PIXELS, width: DAY_WIDTH_PIXELS }}
                className="pointer-events-none absolute top-0 bottom-0 bg-[var(--color-primary)]/10"
              />
            ) : null}

            {/* Dependency arrows sit under the bars so bar drags stay hittable. */}
            <GanttRelationArrows
              relations={relations}
              resolve={resolveAnchor}
              width={chartWidth}
              height={bodyHeight}
            />

            {placements.map(({ node, resolved, left, width, top, height, color, isPlaceholder, label }) => (
              <div
                key={node.task.localId}
                role="button"
                tabIndex={0}
                onPointerDown={(ev) => startDrag(node, 'move', ev)}
                onKeyDown={(ev) => handleKeyNudge(node, ev)}
                style={{ left, width, top, height }}
                className={cn(
                  'group absolute flex items-center rounded-md',
                  node.task.done && 'opacity-50',
                  drag?.taskLocalId === node.task.localId ? 'cursor-grabbing' : 'cursor-grab',
                )}
              >
                {/* Bar fill */}
                <div
                  className={cn(
                    'h-full w-full rounded-md',
                    isPlaceholder && 'border border-dashed',
                  )}
                  style={
                    isPlaceholder
                      ? {
                          borderColor: color,
                          background: `color-mix(in srgb, ${color} 18%, transparent)`,
                        }
                      : { background: color }
                  }
                  title={label}
                />
                {/* Resize handles (not for dateless placeholders) */}
                {!resolved.dateless ? (
                  <>
                    <span
                      onPointerDown={(ev) => startDrag(node, 'resize-start', ev)}
                      className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-md opacity-0 group-hover:opacity-100"
                      style={{ background: 'rgba(0,0,0,0.25)' }}
                    />
                    <span
                      onPointerDown={(ev) => startDrag(node, 'resize-end', ev)}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-md opacity-0 group-hover:opacity-100"
                      style={{ background: 'rgba(0,0,0,0.25)' }}
                    />
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Reorder a cached task array so the ids in `orderedIds` lead, in that order,
 * with every other task kept in its existing relative order after them — the
 * optimistic-reorder cache update (mirrors the table view's helper).
 */
function reorderTasksByIds(tasks: Task[], orderedIds: string[]): Task[] {
  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  const ranked: Task[] = [];
  const rest: Task[] = [];
  for (const t of tasks) (rank.has(t.localId) ? ranked : rest).push(t);
  ranked.sort((a, b) => rank.get(a.localId)! - rank.get(b.localId)!);
  return [...ranked, ...rest];
}

/* ─── Left-rail row (drag-to-reorder handle for top-level tasks) ─── */

function GanttRailRow({
  node,
  collapsed,
  onToggleCollapse,
  onOpenTask,
  sortable,
}: {
  node: GanttTaskNode;
  collapsed: boolean;
  onToggleCollapse: (taskLocalId: string) => void;
  onOpenTask: (taskLocalId: string) => void;
  sortable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.task.localId, disabled: !sortable });

  const style: React.CSSProperties = {
    height: ROW_HEIGHT,
    paddingLeft: 8 + node.indentLevel * 16,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'flex items-center gap-1 border-b border-[var(--color-border)] pr-2 text-sm',
        node.task.done && 'text-[var(--color-muted-foreground)] line-through',
        sortable && 'cursor-grab active:cursor-grabbing',
        isDragging && 'bg-[var(--color-card)] opacity-60',
      )}
    >
      {node.isParent ? (
        <button
          onClick={() => onToggleCollapse(node.task.localId)}
          className="shrink-0 cursor-pointer text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <button
        onClick={() => onOpenTask(node.task.localId)}
        className="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline"
        title={node.task.title}
      >
        {node.task.title}
      </button>
    </div>
  );
}

