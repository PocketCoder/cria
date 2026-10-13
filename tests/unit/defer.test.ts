import { describe, it, expect } from 'vitest';
import { deferDueIso } from '@/lib/defer';

// Wed 14 Oct 2026, local noon.
const NOW = new Date(2026, 9, 14, 12, 0, 0);
const day = (iso: string) => iso.slice(0, 10);

describe('deferDueIso', () => {
  it('pushes an all-day due date by the interval', () => {
    expect(day(deferDueIso('2026-10-20T00:00:00.000Z', '1d', NOW))).toBe('2026-10-21');
    expect(day(deferDueIso('2026-10-20T00:00:00.000Z', '3d', NOW))).toBe('2026-10-23');
    expect(day(deferDueIso('2026-10-20T00:00:00.000Z', '1w', NOW))).toBe('2026-10-27');
  });

  it('counts from today when the due date is already past', () => {
    expect(day(deferDueIso('2026-10-04T00:00:00.000Z', '1d', NOW))).toBe('2026-10-15');
    expect(day(deferDueIso('2026-10-04T00:00:00.000Z', '1w', NOW))).toBe('2026-10-21');
  });

  it('keeps the time of day when an overdue timed task is deferred', () => {
    const current = new Date(2026, 9, 4, 9, 15).toISOString();
    const out = new Date(deferDueIso(current, '1d', NOW));
    expect([out.getDate(), out.getHours(), out.getMinutes()]).toEqual([15, 9, 15]);
  });

  it('counts from today when there is no due date', () => {
    expect(day(deferDueIso(null, '1d', NOW))).toBe('2026-10-15');
    expect(day(deferDueIso(null, '1w', NOW))).toBe('2026-10-21');
  });

  it('keeps the time of day on a timed due date', () => {
    const current = new Date(2026, 9, 20, 15, 30).toISOString();
    const out = new Date(deferDueIso(current, '3d', NOW));
    expect(out.getDate()).toBe(23);
    expect(out.getHours()).toBe(15);
    expect(out.getMinutes()).toBe(30);
  });

  it('next Monday ignores the current due date', () => {
    expect(day(deferDueIso('2026-12-01T00:00:00.000Z', 'nextMonday', NOW))).toBe('2026-10-19');
    expect(day(deferDueIso(null, 'nextMonday', NOW))).toBe('2026-10-19');
  });

  it('next Monday from a Monday is the following Monday', () => {
    const monday = new Date(2026, 9, 19, 9, 0);
    expect(day(deferDueIso(null, 'nextMonday', monday))).toBe('2026-10-26');
  });
});
