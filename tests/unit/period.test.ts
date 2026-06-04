import { describe, it, expect } from 'vitest';
import {
  secondsToPeriod,
  periodToSeconds,
  formatRelativeReminder,
  RELATIVE_REMINDER_PRESETS,
} from '@/lib/period';

describe('secondsToPeriod', () => {
  it('returns 0 minutes for 0 seconds', () => {
    expect(secondsToPeriod(0)).toEqual({ amount: 0, unit: 'minutes' });
  });

  it('converts whole weeks', () => {
    const r = secondsToPeriod(604800);
    expect(r.amount).toBe(1);
    expect(r.unit).toBe('weeks');
  });

  it('converts whole days', () => {
    const r = secondsToPeriod(86400);
    expect(r.amount).toBe(1);
    expect(r.unit).toBe('days');
  });

  it('converts whole hours', () => {
    const r = secondsToPeriod(3600);
    expect(r.amount).toBe(1);
    expect(r.unit).toBe('hours');
  });

  it('converts minutes when no larger unit divides cleanly', () => {
    const r = secondsToPeriod(150);
    expect(r.amount).toBe(2.5);
    expect(r.unit).toBe('minutes');
  });

  it('handles negative values (sign moves to amount)', () => {
    const r = secondsToPeriod(-7200);
    expect(r.amount).toBe(-2);
    expect(r.unit).toBe('hours');
  });

  it('picks the largest clean divisor', () => {
    // 90061s = 1d 1h 1m 1s → no clean divisor → minutes
    const r = secondsToPeriod(90061);
    expect(r.unit).toBe('minutes');
    expect(r.amount).toBeCloseTo(1501.017, 3);
  });

  it('converts multiples of a week', () => {
    const r = secondsToPeriod(1209600);
    expect(r.amount).toBe(2);
    expect(r.unit).toBe('weeks');
  });
});

describe('periodToSeconds', () => {
  it('converts minutes', () => {
    expect(periodToSeconds(5, 'minutes')).toBe(300);
  });

  it('converts hours', () => {
    expect(periodToSeconds(2, 'hours')).toBe(7200);
  });

  it('converts days', () => {
    expect(periodToSeconds(3, 'days')).toBe(259200);
  });

  it('converts weeks', () => {
    expect(periodToSeconds(1, 'weeks')).toBe(604800);
  });

  it('zero amount returns zero', () => {
    expect(periodToSeconds(0, 'hours')).toBe(0);
  });
});

describe('formatRelativeReminder', () => {
  it('formats zero seconds as "On due date"', () => {
    expect(formatRelativeReminder(0, 'due_date')).toBe('On due date');
  });

  it('formats zero seconds as "On start date"', () => {
    expect(formatRelativeReminder(0, 'start_date')).toBe('On start date');
  });

  it('formats zero seconds as "On end date"', () => {
    expect(formatRelativeReminder(0, 'end_date')).toBe('On end date');
  });

  it('formats negative period as "N unit before due date"', () => {
    expect(formatRelativeReminder(-3600, 'due_date')).toBe('1 hour before due date');
  });

  it('formats positive period as "N unit after start date"', () => {
    expect(formatRelativeReminder(7200, 'start_date')).toBe('2 hours after start date');
  });

  it('uses plural unit names for amounts > 1', () => {
    expect(formatRelativeReminder(-172800, 'due_date')).toBe('2 days before due date');
  });

  it('uses singular unit names for amount 1', () => {
    expect(formatRelativeReminder(-86400, 'due_date')).toBe('1 day before due date');
  });

  it('formats weeks', () => {
    expect(formatRelativeReminder(-604800, 'due_date')).toBe('1 week before due date');
  });
});

describe('RELATIVE_REMINDER_PRESETS', () => {
  it('contains the expected presets in order', () => {
    expect(RELATIVE_REMINDER_PRESETS).toEqual([
      { label: 'On', seconds: 0 },
      { label: '2h before', seconds: -7200 },
      { label: '1d before', seconds: -86400 },
      { label: '3d before', seconds: -259200 },
      { label: '1w before', seconds: -604800 },
      { label: '30d before', seconds: -2592000 },
    ]);
  });
});
