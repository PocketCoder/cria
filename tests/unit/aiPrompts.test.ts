import { describe, it, expect } from 'vitest';
import {
  parseLines,
  cleanFilter,
  stripHtml,
  clip,
  clipStart,
  rambleInstructions,
  filterInstructions,
  subtaskPrompt,
  commentsPrompt,
  aiErrorMessage,
} from '@/lib/aiPrompts';
import { needsQuoting, parseQuickAdd } from '@/lib/quickAddParser';
import { parseFilterQuery } from '@/lib/filterQueryParser';

describe('parseLines', () => {
  it('strips bullets, numbering, headings and quotes, and dedupes', () => {
    const out = parseLines(
      'Output:\nHere are your tasks:\n- Buy milk\n2. Call mum\n3) "Pay rent"\n* Walk dog\nbuy MILK\n\n',
    );
    expect(out).toEqual(['Buy milk', 'Call mum', 'Pay rent', 'Walk dog']);
  });

  it('keeps a leading *label token (no space) intact', () => {
    expect(parseLines('*errands Buy stamps')).toEqual(['*errands Buy stamps']);
  });

  it('drops a trailing full stop but keeps an ellipsis', () => {
    expect(parseLines('Book trains.\nThink about it...')).toEqual(['Book trains', 'Think about it...']);
  });

  it('caps the number of lines', () => {
    expect(parseLines('a\nb\nc', 2)).toEqual(['a', 'b']);
  });

  it('yields lines the quick-add parser understands', () => {
    const [line] = parseLines('- Renew car insurance friday !3 +"Home Admin" *car');
    const parsed = parseQuickAdd(line!, new Date('2026-10-02T09:00:00'));
    expect(parsed.title).toBe('Renew car insurance');
    expect(parsed.priority).toBe(3);
    expect(parsed.projectTitle).toBe('Home Admin');
    expect(parsed.labelTitles).toEqual(['car']);
    expect(parsed.dueDate).not.toBeNull();
  });
});

describe('cleanFilter', () => {
  it('unwraps code fences, backticks and prefixes', () => {
    expect(cleanFilter('```\ndone = false && priority >= 3\n```')).toBe('done = false && priority >= 3');
    expect(cleanFilter('Query: `done = false`')).toBe('done = false');
  });

  it('produces queries the filter parser accepts', () => {
    const q = cleanFilter('done = false && labels in "urgent", "work" && dueDate < now+7d\nThis finds…');
    expect(() => parseFilterQuery(q, new Date())).not.toThrow();
  });
});

describe('stripHtml', () => {
  it('turns rich text into plain lines', () => {
    expect(stripHtml('<p>Hi &amp; <b>bye</b></p><p>a&nbsp;b<br>c</p>')).toBe('Hi & bye\na b\nc');
  });
});

describe('clip', () => {
  it('keeps the head or the tail', () => {
    expect(clip('abcdef', 3)).toBe('abc…');
    expect(clipStart('abcdef', 3)).toBe('…def');
    expect(clip('abc', 3)).toBe('abc');
  });
});

describe('prompt builders', () => {
  it('lists projects and labels, quoting multi-word names', () => {
    const s = rambleInstructions({ projects: ['Work', 'Home Admin'], labels: [] });
    expect(s).toContain('Work, "Home Admin"');
    expect(s).toContain('Existing labels: (none)');
    expect(filterInstructions({ projects: ['Work'], labels: ['urgent'] })).toContain('Labels: urgent');
  });

  it('quotes exactly the names the quick-add parser cannot match bare', () => {
    const projects = ['Work', 'Café', "Mum's", 'Home Admin', 'a_b-c'];
    const s = rambleInstructions({ projects, labels: ['Naïve', 'urgent'] });
    expect(s).toContain('Work, "Café", "Mum\'s", "Home Admin", a_b-c');
    expect(s).toContain('Existing labels: "Naïve", urgent');
    // Whatever the prompt tells the model to write must round-trip.
    for (const name of projects) {
      const token = needsQuoting(name) ? `"${name}"` : name;
      expect(parseQuickAdd(`Do it +${token}`).projectTitle).toBe(name);
    }
  });

  it('gives the ramble prompt today and a parseable end-of-month date', () => {
    const now = new Date('2026-02-10T09:00:00');
    const s = rambleInstructions({ projects: [], labels: [], now });
    expect(s).toMatch(/Today is Tuesday,? 10 February 2026/);
    expect(s).toContain('Renew car insurance feb 28 !3');
    expect(parseQuickAdd('Renew car insurance feb 28 !3', now).dueDate).toMatch(/^2026-02-2[78]/);
  });

  it('defaults the ramble prompt to the vikunja syntax', () => {
    const ctx = { projects: ['Home Admin'], labels: ['car'], now: new Date('2026-02-10T09:00:00') };
    const s = rambleInstructions({ ...ctx, mode: 'vikunja' });
    expect(rambleInstructions(ctx)).toBe(s);
    expect(s).toContain('+Project to file it');
    expect(s).toContain('like +"Home Admin"');
    expect(s).toContain('*label to tag it');
    expect(s).toContain('!3 only if');
  });

  it('tells the model to file tasks by subject, not exact words', () => {
    const s = rambleInstructions({ projects: ['Flat'], labels: ['house'] });
    expect(s).toContain('Choose by subject');
    expect(s).toContain('Add every label whose name matches');
  });

  it('asks for todoist syntax in todoist mode, and the todoist parser reads it back', () => {
    const now = new Date('2026-02-10T09:00:00');
    const projects = ['Work', 'Home Admin', "Mum's"];
    const s = rambleInstructions({ projects, labels: ['car'], now, mode: 'todoist' });
    expect(s).toContain('#Project to file it');
    expect(s).toContain('like #"Home Admin" or #"Mum\'s"');
    expect(s).toContain('@label to tag it');
    expect(s).toContain('Renew car insurance feb 28 !3');
    expect(s).not.toMatch(/\+Project|\*label/);
    for (const name of projects) {
      const token = needsQuoting(name) ? `"${name}"` : name;
      expect(parseQuickAdd(`Do it #${token}`, now, 'todoist').projectTitle).toBe(name);
    }
    const [line] = parseLines('- Renew car insurance friday !3 #"Home Admin" @car');
    const parsed = parseQuickAdd(line!, now, 'todoist');
    expect(parsed).toMatchObject({ title: 'Renew car insurance', priority: 3, projectTitle: 'Home Admin', labelTitles: ['car'] });
    expect(parsed.dueDate).not.toBeNull();
  });

  it('asks for plain titles with dates kept in words when the magic is off', () => {
    const now = new Date('2026-02-10T09:00:00');
    const s = rambleInstructions({ projects: ['Work'], labels: ['car'], now, mode: 'disabled' });
    expect(s).toMatch(/Today is Tuesday,? 10 February 2026/);
    expect(s).toContain('no symbols or tags');
    expect(s).toContain('Keep every date and repeat the person mentions in the title, in plain words');
    expect(s).toContain('Renew car insurance before the end of the month');
    // Nothing the model can't use: no project or label lists, no prefix tokens.
    expect(s).not.toContain('Work');
    expect(s).not.toMatch(/[+*#@!]\w/);
    // Upstream-compatible: with the magic off the whole line is the title.
    const parsed = parseQuickAdd('Email the landlord tomorrow', now, 'disabled');
    expect(parsed).toMatchObject({ title: 'Email the landlord tomorrow', dueDate: null });
  });

  it('builds subtask and comment prompts from HTML', () => {
    expect(subtaskPrompt('Plan trip', '<p>Rome</p>')).toBe('Task: Plan trip\nNotes: Rome');
    expect(subtaskPrompt('Plan trip', null)).toBe('Task: Plan trip');
    expect(
      commentsPrompt([{ authorName: 'Sam', comment: '<p>Done?</p>', createdAt: '2026-10-01T10:00:00Z' }]),
    ).toBe('Sam (2026-10-01): Done?');
  });
});

describe('aiErrorMessage', () => {
  it('maps native codes to actionable text', () => {
    expect(aiErrorMessage('unavailable: appleIntelligenceNotEnabled')).toMatch(/Turn on Apple Intelligence/);
    expect(aiErrorMessage('unsupportedOS')).toMatch(/macOS 26/);
    expect(aiErrorMessage(new Error('cancelled'))).toBe('Cancelled.');
    expect(aiErrorMessage('boom')).toBe('Something went wrong: boom');
  });
});
