import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  visibleGanttNodes,
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
import { GanttRelationArrows, type BarGeometry } from './GanttRelationArrows';
import type { GanttRelationEdge } from '@/db/relations';

interface GanttChartProps {
  nodes: GanttTaskNode[];
  relations: GanttRelationEdge[];
  filters: GanttFilters;
  projectColor: string | null;
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
  onUpdateDates,
  onOpenTask,
}: GanttChartProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);

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
    () => visibleGanttNodes(nodes, collapsed, filters.showTasksWithoutDates),
    [nodes, collapsed, filters.showTasksWithoutDates],
  );
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

  const gridBackground = `repeating-linear-gradient(to right, transparent 0, transparent ${
    DAY_WIDTH_PIXELS - 1
  }px, var(--color-border) ${DAY_WIDTH_PIXELS - 1}px, var(--color-border) ${DAY_WIDTH_PIXELS}px)`;

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
        {visible.map((node) => (
          <div
            key={node.task.localId}
            style={{ height: ROW_HEIGHT, paddingLeft: 8 + node.indentLevel * 16 }}
            className={cn(
              'flex items-center gap-1 border-b border-[var(--color-border)] pr-2 text-sm',
              node.task.done && 'text-[var(--color-muted-foreground)] line-through',
            )}
          >
            {node.isParent ? (
              <button
                onClick={() => toggleCollapse(node.task.localId)}
                className="shrink-0 cursor-pointer text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                aria-label={collapsed.has(node.task.localId) ? 'Expand' : 'Collapse'}
              >
                {collapsed.has(node.task.localId) ? (
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
        ))}
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
          <div className="relative" style={{ height: bodyHeight, background: gridBackground }}>
            {todayInRange ? (
              <div
                style={{ left: (today - lo) * DAY_WIDTH_PIXELS, width: DAY_WIDTH_PIXELS }}
                className="pointer-events-none absolute top-0 bottom-0 bg-[var(--color-primary)]/10"
              />
            ) : null}

            {/* Dependency arrows sit under the bars so bar drags stay hittable. */}
            <GanttRelationArrows
              relations={relations}
              geometry={geometry}
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
