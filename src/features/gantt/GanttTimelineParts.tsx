import { cn } from '@/lib/cn';
import { dayToUtcDate, type GanttTaskNode } from './buildGanttTaskTree';
import { DAY_WIDTH_PIXELS, HEADER_HEIGHT } from './constants';
import {
  WEEKDAYS,
  type BarDays,
  type BarPlacement,
  type DragMode,
  type DragState,
  type MonthGroup,
} from './ganttGeometry';

/** Sticky header: month groups + day columns. */
export function GanttTimelineHeader({
  monthGroups,
  lo,
  totalDays,
  today,
}: {
  monthGroups: MonthGroup[];
  lo: number;
  totalDays: number;
  today: number;
}) {
  return (
    <div
      style={{ height: HEADER_HEIGHT }}
      className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-background)]"
    >
      <div className="relative h-5 border-b border-[var(--color-border)]">
        {monthGroups.map((g) => (
          <div
            key={g.left}
            style={{ left: g.left, width: g.width }}
            className="absolute truncate px-1 text-caption font-medium leading-5"
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
                'absolute flex h-full flex-col items-center justify-center text-footnote tabular-nums leading-none',
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
  );
}

/** Day grid plus the today column. */
export function GanttGrid({
  lo,
  totalDays,
  today,
  todayInRange,
}: {
  lo: number;
  totalDays: number;
  today: number;
  todayInRange: boolean;
}) {
  return (
    <>
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
    </>
  );
}

/** One draggable / keyboard-nudgeable bar with its resize handles. */
export function GanttBar({
  placement,
  drag,
  onStartDrag,
  onKeyNudge,
}: {
  placement: BarPlacement;
  drag: DragState | null;
  onStartDrag: (node: GanttTaskNode, mode: DragMode, e: React.PointerEvent) => void;
  onKeyNudge: (node: GanttTaskNode, e: React.KeyboardEvent) => void;
}) {
  const { node, resolved, left, width, top, height, color, isPlaceholder, label } = placement;
  return (
    <div
      aria-label={`${node.task.title}, ${label}`}
      role="button"
      tabIndex={0}
      onPointerDown={(ev) => onStartDrag(node, 'move', ev)}
      onKeyDown={(ev) => onKeyNudge(node, ev)}
      style={{ left, width, top, height }}
      className={cn(
        'group absolute flex items-center rounded-md',
        node.task.done && 'opacity-50',
        drag?.taskLocalId === node.task.localId ? 'cursor-grabbing' : 'cursor-grab',
      )}
    >
      {/* Bar fill */}
      <div
        className={cn('h-full w-full rounded-md', isPlaceholder && 'border border-dashed')}
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
      <ResizeHandles dateless={resolved.dateless} node={node} onStartDrag={onStartDrag} />
    </div>
  );
}

function ResizeHandles({
  dateless,
  node,
  onStartDrag,
}: {
  dateless: BarDays['dateless'];
  node: GanttTaskNode;
  onStartDrag: (node: GanttTaskNode, mode: DragMode, e: React.PointerEvent) => void;
}) {
  if (dateless) return null;
  return (
    <>
      <span
        onPointerDown={(ev) => onStartDrag(node, 'resize-start', ev)}
        className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-md opacity-0 group-hover:opacity-100"
        style={{ background: 'rgba(0,0,0,0.25)' }}
      />
      <span
        onPointerDown={(ev) => onStartDrag(node, 'resize-end', ev)}
        className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-md opacity-0 group-hover:opacity-100"
        style={{ background: 'rgba(0,0,0,0.25)' }}
      />
    </>
  );
}
