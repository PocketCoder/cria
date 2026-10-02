import type { Task } from '@/domain/task';
import { dayToUtcDate, type GanttTaskNode } from './buildGanttTaskTree';
import { DAY_WIDTH_PIXELS, DEFAULT_SPAN_DAYS, ROW_HEIGHT } from './constants';

export type DragMode = 'move' | 'resize-start' | 'resize-end';

export interface DragState {
  taskLocalId: string;
  mode: DragMode;
  startClientX: number;
  origStart: number;
  origEnd: number;
  deltaDays: number;
  moved: boolean;
}

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function normalizeColor(hex: string | null): string | null {
  if (!hex) return null;
  const t = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}|[0-9a-f]{6}$/i.test(t)) return null;
  return `#${t}`;
}

export interface DayRange {
  today: number;
  lo: number;
  hi: number;
  totalDays: number;
}

/** The visible day range (inclusive), tolerant of swapped from/to dates. */
export function computeDayRange(dateFrom: string, dateTo: string, nowMs: number): DayRange {
  const today = Math.floor(nowMs / 86400000);
  const rawFrom = Math.floor(Date.parse(dateFrom) / 86400000);
  const rawTo = Math.floor(Date.parse(dateTo) / 86400000);
  const lo = Math.min(rawFrom, rawTo);
  const hi = Math.max(rawFrom, rawTo);
  return { today, lo, hi, totalDays: hi - lo + 1 };
}

export interface BarDays {
  start: number;
  end: number;
  dateless: boolean;
}

/** Resolve a node's drawn day-range, filling partial / dateless bars. */
export function resolveBarDays(
  node: Pick<GanttTaskNode, 'startDay' | 'endDay'>,
  range: Pick<DayRange, 'today' | 'lo' | 'hi'>,
): BarDays {
  let s = node.startDay;
  let e = node.endDay;
  if (s === null && e === null) {
    const anchor = Math.min(Math.max(range.today, range.lo), range.hi);
    return { start: anchor, end: anchor + DEFAULT_SPAN_DAYS - 1, dateless: true };
  }
  if (s !== null && e === null) e = s + DEFAULT_SPAN_DAYS - 1;
  if (e !== null && s === null) s = e - DEFAULT_SPAN_DAYS + 1;
  return { start: s!, end: e!, dateless: false };
}

export function applyDrag(d: DragState): { start: number; end: number } {
  if (d.mode === 'move') {
    return { start: d.origStart + d.deltaDays, end: d.origEnd + d.deltaDays };
  }
  if (d.mode === 'resize-start') {
    return { start: Math.min(d.origStart + d.deltaDays, d.origEnd), end: d.origEnd };
  }
  return { start: d.origStart, end: Math.max(d.origEnd + d.deltaDays, d.origStart) };
}

export interface MonthGroup {
  label: string;
  left: number;
  width: number;
}

const monthKey = (day: number): string => {
  const d = dayToUtcDate(day);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
};

/** Header month spans (pixel left/width) for the day range starting at `lo`. */
export function buildMonthGroups(lo: number, totalDays: number): MonthGroup[] {
  const groups: MonthGroup[] = [];
  let i = 0;
  while (i < totalDays) {
    const d = dayToUtcDate(lo + i);
    const ym = monthKey(lo + i);
    let span = 0;
    while (i + span < totalDays && monthKey(lo + i + span) === ym) {
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
}

/**
 * Keyboard nudge on a focused bar: ←/→ move a day, Shift+←/→ resize the end,
 * Ctrl/⌘+←/→ resize the start. Null when the key is not an arrow, the bar is a
 * dateless placeholder, or nothing would change.
 */
export function nudgeBar(
  r: BarDays,
  key: string,
  mods: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
): { start: number; end: number } | null {
  const dir = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  if (dir === 0 || r.dateless) return null;
  let ns = r.start;
  let ne = r.end;
  if (mods.shiftKey) ne = Math.max(r.start, r.end + dir);
  else if (mods.metaKey || mods.ctrlKey) ns = Math.min(r.end, r.start + dir);
  else {
    ns = r.start + dir;
    ne = r.end + dir;
  }
  return { start: ns, end: ne };
}

export interface BarPlacement {
  node: GanttTaskNode;
  resolved: BarDays;
  left: number;
  width: number;
  top: number;
  height: number;
  color: string;
  isPlaceholder: boolean;
  label: string;
}

/** Resolve each visible row's bar geometry so bars and arrows share coordinates. */
export function computePlacements(
  visible: GanttTaskNode[],
  range: Pick<DayRange, 'today' | 'lo' | 'hi'>,
  drag: DragState | null,
  chartWidth: number,
  baseColor: string,
): BarPlacement[] {
  return visible.map((node, index) => {
    const resolved = resolveBarDays(node, range);
    let s = resolved.start;
    let e = resolved.end;
    if (drag && drag.taskLocalId === node.task.localId) {
      const p = applyDrag(drag);
      s = p.start;
      e = p.end;
    }
    const rawX = (s - range.lo) * DAY_WIDTH_PIXELS;
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
}

/**
 * Reorder a cached task array so the ids in `orderedIds` lead, in that order,
 * with every other task kept in its existing relative order after them — the
 * optimistic-reorder cache update (mirrors the table view's helper).
 */
export function reorderTasksByIds(tasks: Task[], orderedIds: string[]): Task[] {
  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  const ranked: Task[] = [];
  const rest: Task[] = [];
  for (const t of tasks) (rank.has(t.localId) ? ranked : rest).push(t);
  ranked.sort((a, b) => rank.get(a.localId)! - rank.get(b.localId)!);
  return [...ranked, ...rest];
}
