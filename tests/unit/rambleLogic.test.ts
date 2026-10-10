import { describe, expect, it, vi } from 'vitest';
import {
  acceptAllSuggestions,
  acceptSuggestion,
  hasUsableSuggestion,
  appendBlankDraft,
  splitSuggestion,
  chosenDrafts,
  createDrafts,
  defaultProjectId,
  dictationHint,
  draftsFromLines,
  findProjectByTitle,
  hasTitle,
  patchDraft,
  projectPreview,
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
    expect(chosenDrafts(drafts, 'vikunja').map((d) => d.id)).toEqual([0]);
  });

  it('leaves out token-only lines that have no title to create', () => {
    const drafts = draftsFromLines(['Buy milk +Home', '+Home tomorrow', '!3 *errands', 'Call mum'], 0);
    expect(chosenDrafts(drafts, 'vikunja').map((d) => d.line)).toEqual(['Buy milk +Home', 'Call mum']);
    expect(hasTitle('+Home tomorrow', 'vikunja')).toBe(false);
    expect(hasTitle('  Plan trip  ', 'vikunja')).toBe(true);
  });

  it("judges a line's title with the user's Quick Add Magic mode", () => {
    // Todoist prefixes: `#Home @errands` are tokens, `+Home` would be an assignee.
    expect(hasTitle('#Home tomorrow', 'todoist')).toBe(false);
    expect(hasTitle('!3 @errands', 'todoist')).toBe(false);
    expect(hasTitle('*errands', 'todoist')).toBe(true);
    // Magic off: nothing is a token, so any non-blank line is a title.
    expect(hasTitle('+Home tomorrow', 'disabled')).toBe(true);
    expect(hasTitle('   ', 'disabled')).toBe(false);
  });

  it('keeps a quoted line as a title in every mode, but not an empty pair', () => {
    for (const mode of ['vikunja', 'todoist', 'disabled'] as const) {
      expect(hasTitle(' "+Home tomorrow" ', mode)).toBe(true);
      expect(hasTitle('""', mode)).toBe(false);
    }
  });

  it('previews a known project by name and an unknown one as the fallback', () => {
    const projects = [
      { localId: 'a', title: 'Inbox' },
      { localId: 'b', title: 'Health' },
    ];
    expect(findProjectByTitle(projects, 'health')).toBe(projects[1]);
    expect(findProjectByTitle(projects, 'Home')).toBeUndefined();
    expect(projectPreview(projects, 'HEALTH', 'a')).toEqual({ text: 'Health', unresolved: false });
    expect(projectPreview(projects, 'Home', 'a')).toEqual({
      text: 'No “Home”, using Inbox',
      unresolved: true,
    });
    expect(projectPreview(projects, 'Home', '')).toEqual({
      text: 'No project “Home”',
      unresolved: true,
    });
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
    await createDrafts(chosenDrafts(remaining, 'vikunja'), create, (d) => savedIds.add(d.id));
    expect(create.mock.calls.map(([d]) => d.line)).toEqual(['c', 'd', 'e']);
  });

  it('splits a model line into its title and a suggestion after " ~ "', () => {
    expect(splitSuggestion('Email landlord tomorrow ~ +Flat *house')).toEqual({
      line: 'Email landlord tomorrow',
      suggestion: '+Flat *house',
    });
    expect(splitSuggestion('Buy milk +Home')).toEqual({ line: 'Buy milk +Home' });
    expect(splitSuggestion('Fix ~ approx 5 things')).toEqual({ line: 'Fix', suggestion: 'approx 5 things' });
  });

  it('keeps suggestions off the line until accepted', () => {
    const drafts = draftsFromLines(['Email landlord ~ +Flat', 'Buy milk'], 0);
    expect(drafts[0]).toMatchObject({ line: 'Email landlord', suggestion: '+Flat' });
    expect(drafts[1]!.suggestion).toBeUndefined();
    expect(chosenDrafts(drafts, 'vikunja').map((d) => d.line)).toEqual(['Email landlord', 'Buy milk']);
    const accepted = acceptSuggestion(drafts[0]!, ctx);
    expect(accepted.line).toBe('Email landlord +Flat');
    expect('suggestion' in accepted).toBe(false);
    expect(acceptAllSuggestions(drafts, ctx).map((d) => d.line)).toEqual(['Email landlord +Flat', 'Buy milk']);
  });

  it('accepts only existing projects/labels the line does not already set', () => {
    const d = (line: string, suggestion: string) => ({ id: 0, line, include: true, suggestion });
    // Line already names a project: the suggested one must not override it.
    expect(acceptSuggestion(d('Pay rent +Finance', '+Flat'), ctx).line).toBe('Pay rent +Finance');
    // Unknown project and label are dropped; known label keeps its real casing.
    expect(acceptSuggestion(d('Fix tap', '+Nope *ghost *House'), ctx).line).toBe('Fix tap *house');
    // Duplicate label is not added twice.
    expect(acceptSuggestion(d('Fix tap *house', '*house'), ctx).line).toBe('Fix tap *house');
    // Names needing quotes are quoted; Todoist mode uses its own prefixes.
    expect(acceptSuggestion(d('Call', '#"Home Admin"'), { ...ctx, mode: 'todoist' }).line).toBe('Call #"Home Admin"');
    expect(hasUsableSuggestion(d('Fix tap', '+Nope'), ctx)).toBe(false);
  });

  it('does not split " ~ " when Quick Add Magic is off', () => {
    expect(draftsFromLines(['Read 3 ~ 5 pages'], 0, 'disabled')[0]).toEqual({ id: 0, line: 'Read 3 ~ 5 pages', include: true });
  });
});

const ctx = {
  projects: [{ title: 'Flat' }, { title: 'Finance' }, { title: 'Home Admin' }],
  labels: [{ title: 'house' }],
  mode: 'vikunja' as const,
};
