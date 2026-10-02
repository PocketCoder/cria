import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTask = vi.fn();
const applyLabelsByTitle = vi.fn();
const addReminder = vi.fn();

vi.mock('@/db/tasks', () => ({ createTask: (...a: unknown[]) => createTask(...a) }));
vi.mock('@/db/labels', () => ({
  applyLabelsByTitle: (...a: unknown[]) => applyLabelsByTitle(...a),
}));
vi.mock('@/db/reminders', () => ({ addReminder: (...a: unknown[]) => addReminder(...a) }));

import {
  buildQuickAddInput,
  canSubmitQuickAdd,
  mergeLabelTitles,
  persistQuickAdd,
} from '@/lib/quickAddSubmit';
import { findProjectByTitle, pickFallbackProjectId, resolveProjectChip } from '@/lib/quickAddProject';
import { repeatLabel } from '@/lib/repeatLabel';

const fields = {
  description: '',
  dueDate: null,
  priority: 0,
  repeatAfter: null,
  repeatMode: null,
};
const projects = [
  { localId: 'p1', title: 'Home', serverId: 10, hexColor: 'ff0000' },
  { localId: 'p2', title: 'Work', serverId: 20, hexColor: null },
];

describe('canSubmitQuickAdd', () => {
  it('needs a title', () => {
    expect(canSubmitQuickAdd({ title: '', projectTitle: null }, 'p1')).toBe(false);
  });
  it('needs a project unless a +project token was typed', () => {
    expect(canSubmitQuickAdd({ title: 'x', projectTitle: null }, null)).toBe(false);
    expect(canSubmitQuickAdd({ title: 'x', projectTitle: 'Nope' }, null)).toBe(true);
    expect(canSubmitQuickAdd({ title: 'x', projectTitle: null }, 'p1')).toBe(true);
  });
});

describe('buildQuickAddInput', () => {
  it('keeps the selected project when there is no token', () => {
    expect(buildQuickAddInput({ title: 'x', projectTitle: null }, projects, 'p2', fields)).toEqual({
      title: 'x',
      projectLocalId: 'p2',
    });
  });

  it('resolves a +project token case-insensitively', () => {
    expect(
      buildQuickAddInput({ title: 'x', projectTitle: 'hOmE' }, projects, 'p2', fields),
    ).toEqual({ title: 'x', projectLocalId: 'p1' });
  });

  it('omits the project for an unknown token (falls back to Inbox)', () => {
    expect(
      buildQuickAddInput({ title: 'x', projectTitle: 'Nope' }, projects, 'p2', fields),
    ).toEqual({ title: 'x' });
  });

  it('includes only the fields that are set', () => {
    const input = buildQuickAddInput({ title: 'x', projectTitle: null }, projects, 'p1', {
      description: '  note ',
      dueDate: '2030-01-01T00:00:00.000Z',
      priority: 3,
      repeatAfter: 0,
      repeatMode: 1,
    });
    expect(input).toEqual({
      title: 'x',
      projectLocalId: 'p1',
      description: 'note',
      dueDate: '2030-01-01T00:00:00.000Z',
      priority: 3,
      repeatAfter: 0,
      repeatMode: 1,
    });
  });
});

describe('persistQuickAdd', () => {
  beforeEach(() => {
    createTask.mockReset().mockResolvedValue({ localId: 't1' });
    applyLabelsByTitle.mockReset().mockResolvedValue(undefined);
    addReminder.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('creates the task then applies labels and reminders', async () => {
    const r = [{ kind: 'absolute' }, { kind: 'absolute' }] as never[];
    await persistQuickAdd({ title: 'x' }, ['a'], r, []);
    expect(createTask).toHaveBeenCalledWith({ title: 'x' });
    expect(applyLabelsByTitle).toHaveBeenCalledWith('t1', ['a']);
    expect(addReminder).toHaveBeenCalledTimes(2);
  });

  it('skips labels and reminders when none are set', async () => {
    await persistQuickAdd({ title: 'x' }, [], [], []);
    expect(applyLabelsByTitle).not.toHaveBeenCalled();
    expect(addReminder).not.toHaveBeenCalled();
  });

  it('survives label and reminder failures', async () => {
    applyLabelsByTitle.mockRejectedValue(new Error('labels'));
    addReminder.mockRejectedValue(new Error('reminder'));
    await expect(
      persistQuickAdd({ title: 'x' }, ['a'], [{}] as never[], ['bob']),
    ).resolves.toBeUndefined();
    expect(addReminder).toHaveBeenCalledTimes(1);
  });

  it('propagates a createTask failure', async () => {
    createTask.mockRejectedValue(new Error('boom'));
    await expect(persistQuickAdd({ title: 'x' }, ['a'], [], [])).rejects.toThrow('boom');
    expect(applyLabelsByTitle).not.toHaveBeenCalled();
  });
});

describe('mergeLabelTitles', () => {
  it('unions case-insensitively and keeps order', () => {
    expect(mergeLabelTitles(['Home'], ['home', 'Work'])).toEqual(['Home', 'Work']);
    expect(mergeLabelTitles([], ['a'])).toEqual(['a']);
  });
});

describe('project helpers', () => {
  it('finds projects by title ignoring case', () => {
    expect(findProjectByTitle(projects, 'WORK')?.localId).toBe('p2');
    expect(findProjectByTitle(projects, 'nope')).toBeUndefined();
  });

  it('resolves the chip from the token first, then the chosen project', () => {
    expect(resolveProjectChip('Typed', projects, 'p1')).toEqual({ title: 'Typed', color: null });
    expect(resolveProjectChip(null, projects, 'p1')).toEqual({ title: 'Home', color: 'ff0000' });
    expect(resolveProjectChip(null, projects, null)).toEqual({ title: null, color: null });
  });

  it('picks the fallback project', () => {
    expect(pickFallbackProjectId([], 'p1', 10)).toBeNull();
    expect(pickFallbackProjectId(projects, 'p2', 10)).toBe('p2');
    expect(pickFallbackProjectId(projects, 'pseudo', 20)).toBe('p2');
    expect(pickFallbackProjectId(projects, null, null)).toBe('p1');
    expect(pickFallbackProjectId(projects, null, 999)).toBe('p1');
  });
});

describe('repeatLabel', () => {
  it('labels monthly mode and intervals', () => {
    expect(repeatLabel(null, 1)).toBe('Monthly');
    expect(repeatLabel(null, null)).toBe('');
    expect(repeatLabel(3600, null)).toBe('Hourly');
    expect(repeatLabel(7200, null)).toBe('Every 2 hours');
    expect(repeatLabel(86400, null)).toBe('Daily');
    expect(repeatLabel(172800, null)).toBe('Every 2 days');
    expect(repeatLabel(604800, null)).toBe('Weekly');
    expect(repeatLabel(1209600, null)).toBe('Every 2 weeks');
    expect(repeatLabel(31536000, null)).toBe('Yearly');
    expect(repeatLabel(63072000, null)).toBe('Every 2 years');
    expect(repeatLabel(90, null)).toBe('Every 90s');
  });
});
