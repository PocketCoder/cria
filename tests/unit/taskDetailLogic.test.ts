import { describe, expect, it } from 'vitest';
import {
  countRelated,
  countValue,
  formatDueChip,
  reminderSummary,
  taskRepeatLabel,
  taskWebUrl,
  toggleSection,
  utcMidnightIso,
} from '@/features/task-detail/taskDetailLogic';
import type { TaskReminder } from '@/db/reminders';
import type { DateFormatters } from '@/lib/dateFormat';

describe('taskWebUrl', () => {
  it('builds the URL, trimming trailing slashes', () => {
    expect(taskWebUrl({ serverId: 5 }, 'https://v.example.com//')).toBe('https://v.example.com/tasks/5');
  });
  it('is null without a server id or server url', () => {
    expect(taskWebUrl({ serverId: null }, 'https://v.example.com')).toBeNull();
    expect(taskWebUrl({ serverId: 5 }, null)).toBeNull();
    expect(taskWebUrl({ serverId: 5 }, '')).toBeNull();
  });
});

describe('toggleSection / countValue / countRelated', () => {
  it('toggles a section open and closed', () => {
    expect(toggleSection(null, 'comments')).toBe('comments');
    expect(toggleSection('comments', 'comments')).toBeNull();
    expect(toggleSection('more', 'comments')).toBe('comments');
  });
  it('shows None for zero', () => {
    expect(countValue(0)).toBe('None');
    expect(countValue(3)).toBe('3');
  });
  it('excludes subtask and parent relations', () => {
    expect(
      countRelated([{ kind: 'subtask' }, { kind: 'parenttask' }, { kind: 'related' }, { kind: 'blocking' }]),
    ).toBe(2);
  });
});

describe('utcMidnightIso', () => {
  it('uses the local calendar date at UTC midnight', () => {
    expect(utcMidnightIso(new Date(2030, 4, 17, 15, 30))).toBe('2030-05-17T00:00:00.000Z');
    expect(utcMidnightIso(undefined)).toBeNull();
    expect(utcMidnightIso(null)).toBeNull();
  });
});

describe('formatDueChip', () => {
  it('formats weekday, day and month', () => {
    expect(formatDueChip('2030-05-17T00:00:00.000Z')).toMatch(/^[A-Z][a-z]{2} \d{1,2} May/);
  });
  it('falls back to the raw value', () => {
    expect(formatDueChip('garbage')).toBe('garbage');
  });
});

describe('taskRepeatLabel', () => {
  it('describes repeats', () => {
    expect(taskRepeatLabel({ repeatAfter: 0, repeatMode: 0 })).toBe('Never');
    expect(taskRepeatLabel({ repeatAfter: 100, repeatMode: 1 })).toBe('Monthly');
    expect(taskRepeatLabel({ repeatAfter: 2592000, repeatMode: 0 })).toBe('Every 1 month');
    expect(taskRepeatLabel({ repeatAfter: 5184000, repeatMode: 0 })).toBe('Every 2 months');
    expect(taskRepeatLabel({ repeatAfter: 86400, repeatMode: 0 })).toBe('Every 1 day');
    expect(taskRepeatLabel({ repeatAfter: 172800, repeatMode: 0 })).toBe('Every 2 days');
    expect(taskRepeatLabel({ repeatAfter: 7200, repeatMode: 0 })).toBe('Every 2 hours');
    expect(taskRepeatLabel({ repeatAfter: 90, repeatMode: 0 })).toBe('Every 90s');
  });
});

describe('reminderSummary', () => {
  const fmt = { formatDateTime: (iso: string) => `DT:${iso}` } as unknown as DateFormatters;
  const r = (extra: Partial<TaskReminder>) => ({ ...extra }) as TaskReminder;
  it('summarises empty, absolute and unknown reminders', () => {
    expect(reminderSummary([], fmt)).toBe('None');
    expect(reminderSummary([r({ reminderAt: '2030-01-01T00:00:00Z' })], fmt)).toBe(
      'DT:2030-01-01T00:00:00Z',
    );
    expect(reminderSummary([r({})], fmt)).toBe('Reminder');
  });
  it('prefers a relative description', () => {
    const out = reminderSummary([r({ relativePeriod: -3600, relativeTo: 'due_date' })], fmt);
    expect(out).not.toBe('Reminder');
    expect(out).not.toMatch(/^DT:/);
  });
});
