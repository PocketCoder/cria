import { describe, expect, it } from 'vitest';
import type { Task } from '@/domain/task';
import type { GanttTaskNode } from '@/features/gantt/buildGanttTaskTree';
import { DAY_WIDTH_PIXELS, DEFAULT_SPAN_DAYS, ROW_HEIGHT } from '@/features/gantt/constants';
import {
  applyDrag,
  buildMonthGroups,
  computeDayRange,
  computePlacements,
  normalizeColor,
  nudgeBar,
  resolveBarDays,
  type DragState,
} from '@/features/gantt/ganttGeometry';

const node = (
  id: string,
  startDay: number | null,
  endDay: number | null,
  extra: Partial<GanttTaskNode> = {},
) =>
  ({
    task: { localId: id, hexColor: null, done: false },
    startDay,
    endDay,
    hasDerivedDates: false,
    ...extra,
  }) as unknown as GanttTaskNode;

const range = { today: 100, lo: 90, hi: 120 };
const noMods = { shiftKey: false, metaKey: false, ctrlKey: false };

describe('normalizeColor', () => {
  it('adds a hash and rejects junk', () => {
    expect(normalizeColor(null)).toBeNull();
    expect(normalizeColor('ff0000')).toBe('#ff0000');
    expect(normalizeColor(' #abc ')).toBe('#abc');
    expect(normalizeColor('zzz')).toBeNull();
  });
});

describe('computeDayRange', () => {
  it('orders swapped bounds and counts inclusively', () => {
    const r = computeDayRange('2030-01-10', '2030-01-01', Date.UTC(2030, 0, 5));
    expect(r.hi - r.lo).toBe(9);
    expect(r.totalDays).toBe(10);
    expect(r.today).toBe(Math.floor(Date.UTC(2030, 0, 5) / 86400000));
  });
});

describe('resolveBarDays', () => {
  it('anchors dateless bars on today, clamped to the range', () => {
    expect(resolveBarDays(node('a', null, null), range)).toEqual({
      start: 100,
      end: 100 + DEFAULT_SPAN_DAYS - 1,
      dateless: true,
    });
    expect(resolveBarDays(node('a', null, null), { ...range, today: 10 }).start).toBe(90);
    expect(resolveBarDays(node('a', null, null), { ...range, today: 500 }).start).toBe(120);
  });

  it('fills a missing end or start with the default span', () => {
    expect(resolveBarDays(node('a', 95, null), range)).toEqual({
      start: 95,
      end: 95 + DEFAULT_SPAN_DAYS - 1,
      dateless: false,
    });
    expect(resolveBarDays(node('a', null, 110), range)).toEqual({
      start: 110 - DEFAULT_SPAN_DAYS + 1,
      end: 110,
      dateless: false,
    });
    expect(resolveBarDays(node('a', 95, 99), range)).toEqual({ start: 95, end: 99, dateless: false });
  });
});

describe('applyDrag', () => {
  const base: DragState = {
    taskLocalId: 'a',
    mode: 'move',
    startClientX: 0,
    origStart: 10,
    origEnd: 14,
    deltaDays: 3,
    moved: true,
  };
  it('moves both ends', () => {
    expect(applyDrag(base)).toEqual({ start: 13, end: 17 });
  });
  it('resizes the start without crossing the end', () => {
    expect(applyDrag({ ...base, mode: 'resize-start' })).toEqual({ start: 13, end: 14 });
    expect(applyDrag({ ...base, mode: 'resize-start', deltaDays: 9 })).toEqual({ start: 14, end: 14 });
  });
  it('resizes the end without crossing the start', () => {
    expect(applyDrag({ ...base, mode: 'resize-end' })).toEqual({ start: 10, end: 17 });
    expect(applyDrag({ ...base, mode: 'resize-end', deltaDays: -9 })).toEqual({ start: 10, end: 10 });
  });
});

describe('nudgeBar', () => {
  const r = { start: 10, end: 14, dateless: false };
  it('ignores non-arrow keys and dateless bars', () => {
    expect(nudgeBar(r, 'Enter', noMods)).toBeNull();
    expect(nudgeBar({ ...r, dateless: true }, 'ArrowLeft', noMods)).toBeNull();
  });
  it('moves, resizes the end, or resizes the start', () => {
    expect(nudgeBar(r, 'ArrowRight', noMods)).toEqual({ start: 11, end: 15 });
    expect(nudgeBar(r, 'ArrowLeft', noMods)).toEqual({ start: 9, end: 13 });
    expect(nudgeBar(r, 'ArrowRight', { ...noMods, shiftKey: true })).toEqual({ start: 10, end: 15 });
    expect(nudgeBar(r, 'ArrowLeft', { ...noMods, shiftKey: true })).toEqual({ start: 10, end: 13 });
    expect(nudgeBar(r, 'ArrowRight', { ...noMods, ctrlKey: true })).toEqual({ start: 11, end: 14 });
    expect(nudgeBar(r, 'ArrowLeft', { ...noMods, metaKey: true })).toEqual({ start: 9, end: 14 });
  });
  it('clamps resizes so a bar never inverts', () => {
    const one = { start: 10, end: 10, dateless: false };
    expect(nudgeBar(one, 'ArrowLeft', { ...noMods, shiftKey: true })).toEqual({ start: 10, end: 10 });
    expect(nudgeBar(one, 'ArrowRight', { ...noMods, ctrlKey: true })).toEqual({ start: 10, end: 10 });
  });
});

describe('buildMonthGroups', () => {
  it('splits a range at month boundaries', () => {
    const lo = Math.floor(Date.UTC(2030, 0, 30) / 86400000);
    const groups = buildMonthGroups(lo, 5);
    expect(groups).toEqual([
      { label: 'January 2030', left: 0, width: 2 * DAY_WIDTH_PIXELS },
      { label: 'February 2030', left: 2 * DAY_WIDTH_PIXELS, width: 3 * DAY_WIDTH_PIXELS },
    ]);
  });
  it('is empty for an empty range', () => {
    expect(buildMonthGroups(0, 0)).toEqual([]);
  });
});

describe('computePlacements', () => {
  it('lays rows out and clamps to the chart width', () => {
    const [p] = computePlacements([node('a', 90, 91)], range, null, 10 * DAY_WIDTH_PIXELS, '#111');
    expect(p!.left).toBe(0);
    expect(p!.width).toBe(2 * DAY_WIDTH_PIXELS);
    expect(p!.top).toBe(8);
    expect(p!.height).toBe(ROW_HEIGHT - 16);
    expect(p!.color).toBe('#111');
    expect(p!.isPlaceholder).toBe(false);
    expect(p!.label).toMatch(/^\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}$/);
  });

  it('marks dateless and derived bars as placeholders and honours task colours', () => {
    const rows = [
      node('a', null, null),
      node('b', 91, 92, { hasDerivedDates: true }),
      node('c', 91, 92, { task: { localId: 'c', hexColor: 'ff0000', done: false } as unknown as Task }),
    ];
    const ps = computePlacements(rows, range, null, 100 * DAY_WIDTH_PIXELS, '#111');
    expect(ps.map((p) => p.isPlaceholder)).toEqual([true, true, false]);
    expect(ps[2]!.color).toBe('#ff0000');
    expect(ps[1]!.top).toBe(ROW_HEIGHT + 8);
  });

  it('applies an in-flight drag to the dragged row only', () => {
    const drag: DragState = {
      taskLocalId: 'a',
      mode: 'move',
      startClientX: 0,
      origStart: 91,
      origEnd: 92,
      deltaDays: 2,
      moved: true,
    };
    const ps = computePlacements(
      [node('a', 91, 92), node('b', 91, 92)],
      range,
      drag,
      100 * DAY_WIDTH_PIXELS,
      '#111',
    );
    expect(ps[0]!.left).toBe(3 * DAY_WIDTH_PIXELS);
    expect(ps[1]!.left).toBe(1 * DAY_WIDTH_PIXELS);
  });

  it('keeps a minimum width of 4px', () => {
    const [p] = computePlacements([node('a', 90, 90)], range, null, 0, '#111');
    expect(p!.width).toBe(4);
  });
});
