import { describe, expect, it } from 'vitest';
import {
  describePickerValue,
  parseValue,
  smartColor,
  smartLabel,
  toPickerIso,
} from '@/lib/datePickerValue';

const fmt = (d: Date) => `F${d.getDate()}`;
const daysFromNow = (n: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
};

describe('parseValue', () => {
  it('defaults for empty and invalid values', () => {
    expect(parseValue(null)).toEqual({ hasTime: false, timeStr: '09:00' });
    expect(parseValue('nope')).toEqual({ hasTime: false, timeStr: '09:00' });
  });

  it('treats UTC midnight as all-day and anything else as timed', () => {
    expect(parseValue('2030-01-02T00:00:00.000Z').hasTime).toBe(false);
    expect(parseValue('2030-01-02T10:15:00.000Z').hasTime).toBe(true);
  });
});

describe('smart label and colour', () => {
  it('labels relative days', () => {
    expect(smartLabel(daysFromNow(0), fmt)).toBe('Today');
    expect(smartLabel(daysFromNow(1), fmt)).toBe('Tomorrow');
    expect(smartLabel(daysFromNow(-1), fmt)).toBe('Yesterday');
    expect(smartLabel(daysFromNow(30), fmt)).toBe(fmt(daysFromNow(30)));
    expect(smartLabel(daysFromNow(3), fmt)).not.toBe(fmt(daysFromNow(3)));
  });

  it('colours overdue, today and future', () => {
    expect(smartColor(daysFromNow(-2))).toBe('var(--color-destructive)');
    expect(smartColor(daysFromNow(0))).toBe('var(--color-success-text)');
    expect(smartColor(daysFromNow(2))).toBe('var(--color-primary)');
  });
});

describe('describePickerValue', () => {
  const base = { enableTime: false, smart: false, formatDate: fmt };

  it('is empty without a value', () => {
    expect(describePickerValue(null, base)).toEqual({
      display: null,
      selectedDate: undefined,
      chipColor: undefined,
    });
  });

  it('formats a plain date without a tint', () => {
    const r = describePickerValue('2030-05-17T00:00:00.000Z', base);
    expect(r.display).toMatch(/^F\d+$/);
    expect(r.chipColor).toBeUndefined();
    expect(r.selectedDate).toBeInstanceOf(Date);
  });

  it('tints and relabels in smart mode', () => {
    const today = new Date();
    const iso = new Date(
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
    ).toISOString();
    const r = describePickerValue(iso, { ...base, smart: true });
    expect(r.display).toBe('Today');
    expect(r.chipColor).toBe('var(--color-success-text)');
  });

  it('appends the time for timed values when time is enabled', () => {
    const local = new Date(2030, 4, 17, 14, 30).toISOString();
    expect(describePickerValue(local, { ...base, enableTime: true }).display).toBe(
      'F17 · 14:30',
    );
    expect(describePickerValue(local, base).display).toBe('F17');
  });
});

describe('toPickerIso', () => {
  const d = new Date(2030, 4, 17, 8, 0);

  it('returns null without a date', () => {
    expect(toPickerIso(undefined, true, '09:00', true)).toBeNull();
  });

  it('emits UTC midnight for all-day or when time is disabled', () => {
    const expected = '2030-05-17T00:00:00.000Z';
    expect(toPickerIso(d, true, '09:00', true)).toBe(expected);
    expect(toPickerIso(d, false, '09:00', false)).toBe(expected);
  });

  it('emits a local datetime for timed values', () => {
    expect(toPickerIso(d, false, '14:30', true)).toBe(
      new Date(2030, 4, 17, 14, 30).toISOString(),
    );
  });

  it('treats an unparsable time as midnight local, still timed', () => {
    const iso = toPickerIso(d, false, 'xx:yy', true)!;
    const out = new Date(iso);
    expect([out.getHours(), out.getMinutes()]).toEqual([0, 0]);
    // Never collapses onto the all-day (UTC midnight) encoding, whatever the zone.
    expect(parseValue(iso).hasTime).toBe(true);
  });
});
