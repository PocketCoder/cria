import { describe, it, expect } from 'vitest';
import { calculatePosition } from '@/lib/position';

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
