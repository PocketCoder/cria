import { describe, expect, it, vi } from 'vitest';
import {
  appendBlankDraft,
  chosenDrafts,
  createDrafts,
  defaultProjectId,
  dictationHint,
  draftsFromLines,
  patchDraft,
  removeDraft,
  taskCount,
  withoutSaved,
} from '@/features/ramble/rambleLogic';

describe('rambleLogic', () => {
  it('numbers drafts from the given id and includes them all', () => {
    expect(draftsFromLines(['a', 'b'], 5)).toEqual([
      { id: 5, line: 'a', include: true },
      { id: 6, line: 'b', include: true },
    ]);
    expect(draftsFromLines([], 0)).toEqual([]);
  });

  it('chooses only ticked, non-blank drafts', () => {
    const drafts = [
      { id: 0, line: 'keep', include: true },
      { id: 1, line: 'skipped', include: false },
      { id: 2, line: '   ', include: true },
    ];
    expect(chosenDrafts(drafts).map((d) => d.id)).toEqual([0]);
  });

  it('patches, removes and appends without mutating the input', () => {
    const drafts = [
      { id: 0, line: 'a', include: true },
      { id: 1, line: 'b', include: true },
    ];
    const patched = patchDraft(drafts, 1, { include: false });
    expect(patched[1]).toEqual({ id: 1, line: 'b', include: false });
    expect(drafts[1]!.include).toBe(true);
    expect(removeDraft(drafts, 0)).toEqual([drafts[1]]);
    expect(appendBlankDraft(drafts, 9).at(-1)).toEqual({ id: 9, line: '', include: true });
    expect(drafts).toHaveLength(2);
  });

  it('pluralises the task count', () => {
    expect(taskCount(0)).toBe('0 tasks');
    expect(taskCount(1)).toBe('1 task');
    expect(taskCount(2)).toBe('2 tasks');
  });

  it('defaults to the open project, then the first, then nothing', () => {
    const projects = [{ localId: 'a' }, { localId: 'b' }];
    expect(defaultProjectId(projects, { kind: 'project', localId: 'b' })).toBe('b');
    expect(defaultProjectId(projects, { kind: 'project', localId: 'gone' })).toBe('a');
    expect(defaultProjectId(projects, { kind: 'today' })).toBe('a');
    expect(defaultProjectId(projects, null)).toBe('a');
    expect(defaultProjectId([], { kind: 'today' })).toBe('');
  });

  it('words the dictation hint per platform', () => {
    expect(dictationHint(true)).toContain('microphone');
    expect(dictationHint(false)).toContain('dictation key');
  });
});

describe('saving a batch of drafts', () => {
  const drafts = draftsFromLines(['a', 'b', 'c', 'd', 'e'], 0);

  it('reports each draft saved before a mid-batch failure, so a retry skips them', async () => {
    const create = vi.fn(async (d: { line: string }) => {
      if (d.line === 'c') throw new Error('boom');
    });
    const savedIds = new Set<number>();
    await expect(createDrafts(drafts, create, (d) => savedIds.add(d.id))).rejects.toThrow('boom');
    expect([...savedIds]).toEqual([0, 1]);

    const remaining = withoutSaved(drafts, savedIds);
    expect(remaining.map((d) => d.line)).toEqual(['c', 'd', 'e']);

    create.mockClear();
    create.mockResolvedValue(undefined);
    await createDrafts(chosenDrafts(remaining), create, (d) => savedIds.add(d.id));
    expect(create.mock.calls.map(([d]) => d.line)).toEqual(['c', 'd', 'e']);
  });
});
