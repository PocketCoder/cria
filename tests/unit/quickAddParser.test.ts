import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '@/lib/quickAddParser';

// Fix "now" so date parsing is deterministic — Wed, 2026-05-27T10:00Z.
const NOW = new Date('2026-05-27T10:00:00Z');

describe('parseQuickAdd', () => {
  it('returns plain title when no tokens are present', () => {
    const r = parseQuickAdd('Buy milk', NOW);
    expect(r.title).toBe('Buy milk');
    expect(r.dueDate).toBeNull();
    expect(r.priority).toBeNull();
    expect(r.labelTitles).toEqual([]);
    expect(r.assigneeUsernames).toEqual([]);
  });

  it('strips a label token', () => {
    const r = parseQuickAdd('Buy milk #shopping', NOW);
    expect(r.title).toBe('Buy milk');
    expect(r.labelTitles).toEqual(['shopping']);
  });

  it('supports quoted multi-word labels', () => {
    const r = parseQuickAdd('Plan trip #"south africa" tomorrow', NOW);
    expect(r.title).toBe('Plan trip');
    expect(r.labelTitles).toEqual(['south africa']);
    expect(r.dueDate).not.toBeNull();
  });

  it('accumulates multiple labels', () => {
    const r = parseQuickAdd('#a Bake bread #b', NOW);
    expect(r.title).toBe('Bake bread');
    expect(r.labelTitles).toEqual(['a', 'b']);
  });

  it('strips a priority token and takes the highest if duplicated', () => {
    const r = parseQuickAdd('Hotfix !2 something !4', NOW);
    expect(r.title).toBe('Hotfix something');
    expect(r.priority).toBe(4);
  });

  it('rejects out-of-range priority tokens', () => {
    const r = parseQuickAdd('Triage !9', NOW);
    expect(r.title).toBe('Triage !9');
    expect(r.priority).toBeNull();
  });

  it('strips an assignee token', () => {
    const r = parseQuickAdd('Review PR @alice', NOW);
    expect(r.title).toBe('Review PR');
    expect(r.assigneeUsernames).toEqual(['alice']);
  });

  it('parses a date phrase and removes it from the title', () => {
    const r = parseQuickAdd('Submit invoice next friday', NOW);
    expect(r.title.toLowerCase()).toBe('submit invoice');
    expect(r.dueDate).not.toBeNull();
    // next friday after 2026-05-27 (Wed) is 2026-05-29.
    expect(new Date(r.dueDate!).getUTCDay()).toBe(5);
  });

  it('uses the first date if multiple are present', () => {
    const r = parseQuickAdd('Workshop tomorrow then again next week', NOW);
    // tomorrow = 2026-05-28
    expect(new Date(r.dueDate!).getUTCDate()).toBe(28);
  });

  it('handles everything in one go', () => {
    const r = parseQuickAdd(
      'Buy milk tomorrow #shopping !2 @alice',
      NOW,
    );
    expect(r.title).toBe('Buy milk');
    expect(r.dueDate).not.toBeNull();
    expect(r.priority).toBe(2);
    expect(r.labelTitles).toEqual(['shopping']);
    expect(r.assigneeUsernames).toEqual(['alice']);
  });

  it('leaves stray symbols (mid-word #, !, @) inside the title', () => {
    const r = parseQuickAdd('Email me at jake@example.com about C#', NOW);
    // `@example` is a valid assignee match in our regex (we require a
    // leading space). `email me at jake` has no leading space, so it
    // shouldn't claim. `C#` likewise — no whitespace boundary before #.
    expect(r.assigneeUsernames).toEqual([]);
    expect(r.labelTitles).toEqual([]);
    expect(r.title).toBe('Email me at jake@example.com about C#');
  });

  it('strips a +project token', () => {
    const r = parseQuickAdd('Buy milk +MyProject', NOW);
    expect(r.title).toBe('Buy milk');
    expect(r.projectTitle).toBe('MyProject');
  });

  it('supports project names with hyphens and underscores', () => {
    const r = parseQuickAdd('Fix bug +my-project_1', NOW);
    expect(r.title).toBe('Fix bug');
    expect(r.projectTitle).toBe('my-project_1');
  });

  it('strips +project and combines with other tokens', () => {
    const r = parseQuickAdd('Design +Frontend tomorrow #ux !3', NOW);
    expect(r.title).toBe('Design');
    expect(r.projectTitle).toBe('Frontend');
    expect(r.dueDate).not.toBeNull();
    expect(r.priority).toBe(3);
    expect(r.labelTitles).toEqual(['ux']);
  });

  it('strays + mid-word stays in the title', () => {
    const r = parseQuickAdd('C++ book', NOW);
    expect(r.title).toBe('C++ book');
    expect(r.projectTitle).toBeNull();
  });

  it('produces interleaved tokens for live preview', () => {
    const r = parseQuickAdd('Ship #v2 tomorrow', NOW);
    const kinds = r.tokens.map((t) => t.kind);
    expect(kinds).toContain('text');
    expect(kinds).toContain('label');
    expect(kinds).toContain('date');
  });
});
