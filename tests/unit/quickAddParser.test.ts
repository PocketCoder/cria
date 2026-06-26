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
    expect(r.projectTitle).toBeNull();
  });

  it('strips a label token', () => {
    const r = parseQuickAdd('Buy milk *shopping', NOW);
    expect(r.title).toBe('Buy milk');
    expect(r.labelTitles).toEqual(['shopping']);
  });

  it('supports quoted multi-word labels', () => {
    const r = parseQuickAdd('Plan trip *"south africa" tomorrow', NOW);
    expect(r.title).toBe('Plan trip');
    expect(r.labelTitles).toEqual(['south africa']);
    expect(r.dueDate).not.toBeNull();
  });

  it('accumulates multiple labels', () => {
    const r = parseQuickAdd('*a Bake bread *b', NOW);
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

  it('strips a project token', () => {
    const r = parseQuickAdd('Fix bugs +Personal', NOW);
    expect(r.title).toBe('Fix bugs');
    expect(r.projectTitle).toBe('Personal');
  });

  it('supports quoted multi-word project names', () => {
    const r = parseQuickAdd('Plan trip +"Work Projects" tomorrow', NOW);
    expect(r.title).toBe('Plan trip');
    expect(r.projectTitle).toBe('Work Projects');
    expect(r.dueDate).not.toBeNull();
  });

  it('accepts smart/curly quotes (macOS auto-substitution)', () => {
    // “ ” are U+201C / U+201D, which text inputs insert by default.
    const r = parseQuickAdd('hello +“Hello you” *“two words”', NOW);
    expect(r.title).toBe('hello');
    expect(r.projectTitle).toBe('Hello you');
    expect(r.labelTitles).toEqual(['two words']);
  });

  it('previews an unterminated quoted label (no closing quote yet)', () => {
    const r = parseQuickAdd('*"hello you', NOW);
    expect(r.title).toBe('');
    expect(r.labelTitles).toEqual(['hello you']);
  });

  it('previews an unterminated quoted project (smart open quote)', () => {
    const r = parseQuickAdd('Plan trip +“Work St', NOW);
    expect(r.title).toBe('Plan trip');
    expect(r.projectTitle).toBe('Work St');
  });

  it('does not chip an empty open quote', () => {
    const r = parseQuickAdd('todo *"', NOW);
    expect(r.labelTitles).toEqual([]);
    expect(r.title).toBe('todo *"');
  });

  it('takes the last project token if multiple are present', () => {
    const r = parseQuickAdd('+Dev Write tests +Personal', NOW);
    expect(r.title).toBe('Write tests');
    expect(r.projectTitle).toBe('Personal');
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
      'Buy milk tomorrow *shopping !2 @alice +Personal',
      NOW,
    );
    expect(r.title).toBe('Buy milk');
    expect(r.dueDate).not.toBeNull();
    expect(r.priority).toBe(2);
    expect(r.labelTitles).toEqual(['shopping']);
    expect(r.assigneeUsernames).toEqual(['alice']);
    expect(r.projectTitle).toBe('Personal');
  });

  it('leaves stray symbols inside the title', () => {
    const r = parseQuickAdd('email@home.com loves u+2764 and C#', NOW);
    expect(r.labelTitles).toEqual([]);
    expect(r.assigneeUsernames).toEqual([]);
    expect(r.projectTitle).toBeNull();
    expect(r.title).toBe('email@home.com loves u+2764 and C#');
  });

  it('produces interleaved tokens for live preview', () => {
    const r = parseQuickAdd('Ship *v2 tomorrow @bob', NOW);
    const kinds = r.tokens.map((t) => t.kind);
    expect(kinds).toContain('text');
    expect(kinds).toContain('label');
    expect(kinds).toContain('date');
    expect(kinds).toContain('assignee');
  });

  it('parses "every day" as daily recurrence', () => {
    const r = parseQuickAdd('Water plants every day', NOW);
    expect(r.title).toBe('Water plants');
    expect(r.repeatAfter).toBe(86400);
    expect(r.repeatMode).toBe(0);
  });

  it('parses "daily" shorthand', () => {
    const r = parseQuickAdd('Water routine daily', NOW);
    expect(r.title).toBe('Water routine');
    expect(r.repeatAfter).toBe(86400);
    expect(r.repeatMode).toBe(0);
  });

  it('parses "every N days"', () => {
    const r = parseQuickAdd('Take meds every 3 days', NOW);
    expect(r.title).toBe('Take meds');
    expect(r.repeatAfter).toBe(259200);
    expect(r.repeatMode).toBe(0);
  });

  it('parses "weekly" and "every week"', () => {
    const r1 = parseQuickAdd('Team standup weekly', NOW);
    expect(r1.repeatAfter).toBe(604800);
    expect(r1.repeatMode).toBe(0);
    const r2 = parseQuickAdd('Review every week', NOW);
    expect(r2.repeatAfter).toBe(604800);
    expect(r2.repeatMode).toBe(0);
  });

  it('parses "monthly" and "every month"', () => {
    const r1 = parseQuickAdd('Pay rent monthly', NOW);
    expect(r1.repeatAfter).toBeNull();
    expect(r1.repeatMode).toBe(1);
    const r2 = parseQuickAdd('Check in every month', NOW);
    expect(r2.repeatAfter).toBeNull();
    expect(r2.repeatMode).toBe(1);
  });

  it('parses day-of-week: "every monday" as weekly', () => {
    const r = parseQuickAdd('Prep meals every monday', NOW);
    expect(r.title).toBe('Prep meals');
    expect(r.repeatAfter).toBe(604800);
    expect(r.repeatMode).toBe(0);
  });

  it('strips recurrence and date together', () => {
    const r = parseQuickAdd('Submit report tomorrow monthly', NOW);
    expect(r.title).toBe('Submit report');
    expect(r.dueDate).not.toBeNull();
    expect(r.repeatMode).toBe(1);
  });

  it('includes recurrence token in interleaved tokens', () => {
    const r = parseQuickAdd('Gym daily', NOW);
    const kinds = r.tokens.map((t) => t.kind);
    expect(kinds).toContain('recurrence');
    const recTok = r.tokens.find((t) => t.kind === 'recurrence');
    expect(recTok).toBeDefined();
    if (recTok?.kind === 'recurrence') {
      expect(recTok.repeatAfter).toBe(86400);
    }
  });

  it('leaves unparseable "every" phrases in the title', () => {
    const r = parseQuickAdd('Review every detail', NOW);
    expect(r.repeatAfter).toBeNull();
    expect(r.repeatMode).toBeNull();
    expect(r.title).toBe('Review every detail');
  });

  it('stores a bare date as all-day (UTC midnight), not now-time', () => {
    const r = parseQuickAdd('Pay rent tomorrow', NOW);
    expect(r.title).toBe('Pay rent');
    const d = new Date(r.dueDate!);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(4); // May (0-based)
    expect(d.getUTCDate()).toBe(28);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it('preserves an explicit time of day', () => {
    const r = parseQuickAdd('Call mum tomorrow at 5pm', NOW);
    expect(r.title).toBe('Call mum');
    // Local 17:00 regardless of the runner's timezone.
    expect(new Date(r.dueDate!).getHours()).toBe(17);
  });
});
