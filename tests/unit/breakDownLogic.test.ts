import { describe, expect, it, vi } from 'vitest';
import {
  addSubtasks,
  applyProgress,
  chosenSubtasks,
  type Suggestion,
} from '@/features/task-detail/breakDownLogic';

const suggestions: Suggestion[] = [
  { title: 'a', include: true },
  { title: '  ', include: true },
  { title: 'b', include: false },
  { title: ' c ', include: true },
];

describe('chosenSubtasks', () => {
  it('keeps ticked, non-blank suggestions with their list index and trimmed title', () => {
    expect(chosenSubtasks(suggestions)).toEqual([
      { index: 0, title: 'a' },
      { index: 3, title: 'c' },
    ]);
  });
  it('carries over an already-created task id', () => {
    expect(chosenSubtasks([{ title: 'a', include: true, createdId: 't1' }])).toEqual([
      { index: 0, title: 'a', createdId: 't1' },
    ]);
  });
});

describe('addSubtasks', () => {
  const drafts = ['a', 'b', 'c'].map((title, index) => ({ index, title }));
  const asSuggestions = () => drafts.map((d) => ({ title: d.title, include: true }));

  function setup(link: (id: string) => Promise<void>) {
    const created = new Map<number, string>();
    const linked = new Set<number>();
    const create = vi.fn(async (title: string) => `t-${title}`);
    const deps = {
      create,
      link,
      onCreated: (i: number, id: string) => created.set(i, id),
      onLinked: (i: number) => linked.add(i),
    };
    return { created, linked, create, deps };
  }

  it('creates and links every draft', async () => {
    const link = vi.fn(async (_id: string) => undefined);
    const { create, linked, deps } = setup(link);
    await addSubtasks(drafts, deps);
    expect(create).toHaveBeenCalledTimes(3);
    expect(link.mock.calls.map(([id]) => id)).toEqual(['t-a', 't-b', 't-c']);
    expect([...linked]).toEqual([0, 1, 2]);
  });

  it('on a mid-batch create failure, a retry only creates the remainder', async () => {
    const link = vi.fn(async () => undefined);
    const { created, linked, create, deps } = setup(link);
    create.mockImplementation(async (title: string) => {
      if (title === 'b') throw new Error('boom');
      return `t-${title}`;
    });
    await expect(addSubtasks(drafts, deps)).rejects.toThrow('boom');
    expect([...linked]).toEqual([0]);

    const left = applyProgress(asSuggestions(), created, linked);
    expect(left.map((s) => s.title)).toEqual(['b', 'c']);

    create.mockClear();
    create.mockImplementation(async (title: string) => `t-${title}`);
    await addSubtasks(chosenSubtasks(left), deps);
    expect(create.mock.calls.map(([t]) => t)).toEqual(['b', 'c']);
  });

  it('after a link failure, a retry links the created task instead of creating another', async () => {
    const link = vi
      .fn<(id: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('link failed'))
      .mockResolvedValue(undefined);
    const { created, linked, create, deps } = setup(link);
    await expect(addSubtasks(drafts, deps)).rejects.toThrow('link failed');
    expect([...linked]).toEqual([0]);
    expect(created.get(1)).toBe('t-b');

    const left = applyProgress(asSuggestions(), created, linked);
    expect(left).toEqual([
      { title: 'b', include: true, createdId: 't-b' },
      { title: 'c', include: true },
    ]);

    create.mockClear();
    link.mockClear();
    await addSubtasks(chosenSubtasks(left), deps);
    expect(create.mock.calls.map(([t]) => t)).toEqual(['c']);
    expect(link.mock.calls.map(([id]) => id)).toEqual(['t-b', 't-c']);
  });
});
