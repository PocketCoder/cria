import { describe, it, expect } from 'vitest';
import { calculatePosition, canMidpoint, planReorder } from '@/lib/position';

describe('calculatePosition', () => {
  it('returns baseStep when no neighbours', () => {
    expect(calculatePosition(null, null)).toBe(1024);
    expect(calculatePosition(undefined, undefined)).toBe(1024);
  });

  it('offsets from before when only before is given', () => {
    expect(calculatePosition(5000, null)).toBe(6024);
    expect(calculatePosition(0, null)).toBe(1024);
  });

  it('halves after when only after is given', () => {
    expect(calculatePosition(null, 5000)).toBe(2500);
    expect(calculatePosition(null, 1000)).toBe(500);
  });

  it('returns midpoint of before and after', () => {
    expect(calculatePosition(2000, 4000)).toBe(3000);
    expect(calculatePosition(0, 1024)).toBe(512);
    expect(calculatePosition(1000, 3000)).toBe(2000);
  });

  it('handles fractional positions', () => {
    expect(calculatePosition(100, 200)).toBe(150);
    expect(calculatePosition(1, 2)).toBe(1.5);
  });

  it('uses custom baseStep', () => {
    expect(calculatePosition(null, null, 2048)).toBe(2048);
    expect(calculatePosition(5000, null, 2048)).toBe(7048);
  });
});

describe('canMidpoint', () => {
  it('rejects when both neighbours are missing (degenerate list → re-index)', () => {
    expect(canMidpoint(null, null)).toBe(false);
    expect(canMidpoint(undefined, undefined)).toBe(false);
  });

  it('allows inserting at the bottom (only a before neighbour)', () => {
    expect(canMidpoint(1024, null)).toBe(true);
    expect(canMidpoint(0, null)).toBe(true);
  });

  it('allows inserting at the top only when there is room below `after`', () => {
    expect(canMidpoint(null, 1024)).toBe(true);
    // after=0 → after/2=0 would collide with the top item, so re-index
    expect(canMidpoint(null, 0)).toBe(false);
  });

  it('allows a strictly-increasing gap between two distinct neighbours', () => {
    expect(canMidpoint(1024, 2048)).toBe(true);
    expect(canMidpoint(1, 2)).toBe(true);
  });

  it('rejects equal or inverted neighbours (no gap to insert into)', () => {
    // every freshly-created task has position 0 → all neighbours collide
    expect(canMidpoint(0, 0)).toBe(false);
    expect(canMidpoint(2048, 2048)).toBe(false);
    expect(canMidpoint(2048, 1024)).toBe(false);
  });
});

describe('planReorder', () => {
  const pos = (m: Record<string, number | null>) => (id: string) => m[id];

  it('midpoints between two distinct neighbours', () => {
    // order a,c,b → c moved between a(1024) and b(2048)
    const plan = planReorder(['a', 'c', 'b'], 'c', pos({ a: 1024, b: 2048, c: 0 }));
    expect(plan).toEqual({ type: 'midpoint', position: 1536 });
  });

  it('midpoints to the top (only an after neighbour)', () => {
    const plan = planReorder(['c', 'a', 'b'], 'c', pos({ a: 1024, b: 2048, c: 0 }));
    expect(plan).toEqual({ type: 'midpoint', position: 512 });
  });

  it('offsets at the bottom (only a before neighbour)', () => {
    const plan = planReorder(['a', 'b', 'c'], 'c', pos({ a: 1024, b: 2048, c: 0 }));
    expect(plan).toEqual({ type: 'midpoint', position: 3072 });
  });

  it('re-indexes when neighbours collide (all positions 0 — fresh list)', () => {
    const plan = planReorder(['b', 'a', 'c'], 'b', pos({ a: 0, b: 0, c: 0 }));
    expect(plan).toEqual({ type: 'reindex' });
  });

  it('re-indexes when a neighbour position is null/missing', () => {
    const plan = planReorder(['a', 'x', 'b'], 'x', pos({ a: null, b: 2048, x: 0 }));
    expect(plan).toEqual({ type: 'reindex' });
  });

  it('re-indexes when the moved id is not in the order', () => {
    expect(planReorder(['a', 'b'], 'zzz', pos({ a: 1, b: 2 }))).toEqual({ type: 'reindex' });
  });
});
