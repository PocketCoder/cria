// Due-date convention: all-day = exactly UTC midnight (DatePicker / quick-add
// "tomorrow"); anything else is a timed instant and uses the *local* day and
// time. These tests run the same instants under several timezones by switching
// process.env.TZ (Node re-reads it on assignment), since vitest doesn't pin TZ.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '@/stores/settings';
import { dueCalendarDate, dueDayKey, hasTimeOfDay, timedIso } from '@/lib/dateFormat';
import { formatDue, isOverdue } from '@/features/tasks/taskRowHelpers';
import { formatDueChip, pickDayIso, utcMidnightIso } from '@/features/task-detail/taskDetailLogic';
import { todaySectioner } from '@/features/smart-views/sectioners';
import { groupToday, upcomingFrom } from '@/queries/smartViews';
import { parseValue, toPickerIso } from '@/lib/datePickerValue';
import { parseQuickAdd } from '@/lib/quickAddParser';
import type { DisplayCtx } from '@/lib/displayConfig';
import type { TaskWithProject } from '@/db/tasks';

const LONDON = 'Europe/London'; // BST (UTC+1) in October
const NEW_YORK = 'America/New_York'; // EDT (UTC-4) in October
const AUCKLAND = 'Pacific/Auckland'; // NZDT (UTC+13) in October

const originalTz = process.env.TZ;
const setTz = (tz: string) => {
  process.env.TZ = tz;
};

beforeEach(() => {
  useSettings.setState({ dateFormat: 'YYYY-MM-DD', timeFormat: '24h' });
});

afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const task = (localId: string, dueDate: string | null) =>
  ({ localId, dueDate, done: false }) as unknown as TaskWithProject;

describe('hasTimeOfDay', () => {
  it('is false only for exactly UTC midnight', () => {
    expect(hasTimeOfDay('2026-10-03T00:00:00.000Z')).toBe(false);
    expect(hasTimeOfDay('2026-10-03T00:00:00Z')).toBe(false);
    expect(hasTimeOfDay('2026-10-03T00:00:01Z')).toBe(true);
    expect(hasTimeOfDay('2026-10-03T00:00:00.500Z')).toBe(true);
    expect(hasTimeOfDay('2026-10-03T00:30:00Z')).toBe(true);
    expect(hasTimeOfDay(null)).toBe(false);
    expect(hasTimeOfDay('garbage')).toBe(false);
  });
});

describe('timedIso', () => {
  it('leaves ordinary instants alone and nudges UTC midnight off the all-day encoding', () => {
    const ordinary = new Date('2026-10-03T08:15:00Z');
    expect(timedIso(ordinary)).toBe('2026-10-03T08:15:00.000Z');
    const midnight = new Date('2026-10-03T00:00:00Z');
    expect(timedIso(midnight)).toBe('2026-10-03T00:00:01.000Z');
    expect(hasTimeOfDay(timedIso(midnight))).toBe(true);
  });
});

describe.each([LONDON, NEW_YORK, AUCKLAND, 'UTC'])('all-day values in %s', (tz) => {
  it('keep the picked day, with no time', () => {
    setTz(tz);
    const iso = '2026-10-03T00:00:00.000Z';
    expect(dueDayKey(iso)).toBe('2026-10-03');
    expect(formatDue(iso)).toBe('3 Oct');
    expect(formatDueChip(iso)).toBe('Sat 3 Oct');
    expect(dueCalendarDate(iso).getDate()).toBe(3);
  });
});

describe('timed values use the local day and time', () => {
  it('London BST: 00:30 on 3 Oct is 3 Oct, not 2 Oct', () => {
    setTz(LONDON);
    const iso = '2026-10-02T23:30:00.000Z'; // 00:30 BST on Sat 3 Oct
    expect(formatDueChip(iso)).toBe('Sat 3 Oct, 00:30');
    expect(formatDue(iso)).toBe('3 Oct, 00:30');
    expect(dueDayKey(iso)).toBe('2026-10-03');
    expect(dueCalendarDate(iso)).toEqual(new Date(2026, 9, 3));
  });

  it('New York: 8pm on 2 Oct (00:00:01Z) is 2 Oct with its time', () => {
    setTz(NEW_YORK);
    const iso = '2026-10-03T00:00:01.000Z'; // 20:00:01 EDT on Fri 2 Oct
    expect(formatDueChip(iso)).toBe('Fri 2 Oct, 20:00');
    expect(formatDue(iso)).toBe('2 Oct, 20:00');
    expect(dueDayKey(iso)).toBe('2026-10-02');
  });

  it('Auckland: early morning timed value stays on its local day', () => {
    setTz(AUCKLAND);
    const iso = '2026-10-02T12:30:00.000Z'; // 01:30 NZDT on Sat 3 Oct
    expect(formatDueChip(iso)).toBe('Sat 3 Oct, 01:30');
    expect(dueDayKey(iso)).toBe('2026-10-03');
  });
});

describe('writers never emit a timed value that reads back as all-day', () => {
  it('New York: DatePicker 8pm', () => {
    setTz(NEW_YORK);
    const iso = toPickerIso(new Date(2026, 9, 2), false, '20:00', true)!;
    expect(parseValue(iso).hasTime).toBe(true);
    expect(formatDueChip(iso)).toBe('Fri 2 Oct, 20:00');
  });

  it('London winter: DatePicker midnight', () => {
    setTz(LONDON);
    const iso = toPickerIso(new Date(2026, 11, 1), false, '00:00', true)!; // GMT: local == UTC
    expect(parseValue(iso).hasTime).toBe(true);
    expect(formatDueChip(iso)).toBe('Tue 1 Dec, 00:00');
  });

  it('New York: quick-add "tomorrow at 8pm"', () => {
    setTz(NEW_YORK);
    const now = new Date('2026-10-02T15:00:00Z'); // 11:00 EDT Fri 2 Oct
    const r = parseQuickAdd('Dinner tomorrow at 8pm', now);
    expect(hasTimeOfDay(r.dueDate)).toBe(true);
    expect(formatDueChip(r.dueDate!)).toBe('Sat 3 Oct, 20:00');
  });
});

describe.each([LONDON, NEW_YORK, AUCKLAND, 'UTC'])('picking a day in %s', (tz) => {
  it('utcMidnightIso stores the picked day as all-day, unlike local-midnight toISOString', () => {
    setTz(tz);
    const picked = new Date(2026, 9, 3); // local midnight, as the Calendar emits
    const iso = utcMidnightIso(picked)!;
    expect(iso).toBe('2026-10-03T00:00:00.000Z');
    expect(hasTimeOfDay(iso)).toBe(false);
    expect(dueDayKey(iso)).toBe('2026-10-03');
    expect(utcMidnightIso(undefined)).toBeNull();
  });

  it('pickDayIso keeps an all-day task all-day', () => {
    setTz(tz);
    const iso = pickDayIso(new Date(2026, 9, 5), '2026-10-03T00:00:00.000Z');
    expect(iso).toBe('2026-10-05T00:00:00.000Z');
    expect(pickDayIso(new Date(2026, 9, 5), null)).toBe('2026-10-05T00:00:00.000Z');
    expect(pickDayIso(undefined, '2026-10-03T00:00:00.000Z')).toBeNull();
  });

  it('pickDayIso moves a timed task to the new local day, keeping its local time', () => {
    setTz(tz);
    const current = timedIso(new Date(2026, 9, 3, 14, 30)); // 14:30 local on 3 Oct
    const iso = pickDayIso(new Date(2026, 9, 5), current)!;
    expect(hasTimeOfDay(iso)).toBe(true);
    expect(dueCalendarDate(iso)).toEqual(new Date(2026, 9, 5));
    expect(formatDueChip(iso)).toBe('Mon 5 Oct, 14:30');
  });
});

describe('pickDayIso on a timed task near UTC midnight', () => {
  it('New York: 8pm stays timed (not collapsed to all-day) on the new day', () => {
    setTz(NEW_YORK);
    const current = timedIso(new Date(2026, 9, 2, 20, 0)); // 00:00:01Z
    const iso = pickDayIso(new Date(2026, 9, 6), current)!;
    expect(hasTimeOfDay(iso)).toBe(true);
    expect(formatDueChip(iso)).toBe('Tue 6 Oct, 20:00');
  });
});

describe('isOverdue', () => {
  it('New York: due yesterday 21:00 local is overdue, though its UTC day is today', () => {
    setTz(NEW_YORK);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T18:00:00Z')); // 14:00 EDT Fri 2 Oct
    expect(isOverdue('2026-10-02T01:00:00.000Z')).toBe(true); // 21:00 EDT Thu 1 Oct
  });

  it('London BST: 00:30 today is not overdue', () => {
    setTz(LONDON);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T10:00:00Z')); // 11:00 BST Sat 3 Oct
    expect(isOverdue('2026-10-02T23:30:00.000Z')).toBe(false);
  });

  it('all-day values compare by the picked day in any zone', () => {
    setTz(NEW_YORK);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T18:00:00Z'));
    expect(isOverdue('2026-10-01T00:00:00.000Z')).toBe(true);
    expect(isOverdue('2026-10-02T00:00:00.000Z')).toBe(false);
  });
});

describe('Today view sectioning', () => {
  it('New York: a task due yesterday 21:00 is Overdue, not Today', () => {
    setTz(NEW_YORK);
    const ctx = { today: new Date(2026, 9, 2) } as unknown as DisplayCtx;
    const groups = todaySectioner([task('late', '2026-10-02T01:00:00.000Z')], ctx);
    expect(groups.map((g) => g.key)).toEqual(['overdue']);
  });

  it('London BST: a task due 00:30 today is Today, not Overdue', () => {
    setTz(LONDON);
    const ctx = { today: new Date(2026, 9, 3) } as unknown as DisplayCtx;
    const groups = todaySectioner([task('early', '2026-10-02T23:30:00.000Z')], ctx);
    expect(groups.map((g) => g.key)).toEqual(['today']);
  });

  it('groupToday and upcomingFrom agree', () => {
    setTz(LONDON);
    const now = new Date('2026-10-03T10:00:00Z');
    const early = task('early', '2026-10-02T23:30:00.000Z');
    expect(groupToday([early], now).map((g) => [g.key, g.tasks.length])).toEqual([['today', 1]]);
    expect(upcomingFrom([early], now)).toHaveLength(1);
  });
});
