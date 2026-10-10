import { describe, expect, it } from 'vitest';
import { needsQuoting, parseQuickAdd, parseQuickAddTask } from '@/lib/quickAddParser';

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

  it('keeps "every 1 month" as monthly mode', () => {
    const r = parseQuickAdd('Pay rent every 1 month', NOW);
    expect(r.repeatAfter).toBeNull();
    expect(r.repeatMode).toBe(1);
  });

  it('approximates "every N months" (N > 1) as N x 30 days instead of dropping N', () => {
    const r = parseQuickAdd('Dentist every 3 months', NOW);
    expect(r.repeatAfter).toBe(3 * 2592000);
    expect(r.repeatMode).toBe(0);
    expect(r.title).toBe('Dentist');
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

describe('needsQuoting', () => {
  it('flags names outside the unquoted token class', () => {
    for (const name of ['Work', 'a_b-c', 'Q4']) expect(needsQuoting(name)).toBe(false);
    for (const name of ['Café', "Mum's", 'Home Admin', 'Naïve', '']) expect(needsQuoting(name)).toBe(true);
  });

  it('matches the parser: bare accented names stay in the title, quoted ones parse', () => {
    expect(parseQuickAdd('Buy bread +Café', NOW).projectTitle).toBeNull();
    expect(parseQuickAdd('Buy bread +"Café"', NOW).projectTitle).toBe('Café');
    const r = parseQuickAdd('Call mum +"Mum\'s" *"Mum\'s list"', NOW);
    expect(r.projectTitle).toBe("Mum's");
    expect(r.labelTitles).toEqual(["Mum's list"]);
    expect(r.title).toBe('Call mum');
  });
});

describe('parseQuickAdd modes', () => {
  it('defaults to the vikunja prefixes', () => {
    const line = 'Buy milk *shopping !2 @alice +Personal';
    expect(parseQuickAdd(line, NOW, 'vikunja')).toEqual(parseQuickAdd(line, NOW));
  });

  describe('todoist', () => {
    it('reads @label, #project, +assignee and !priority', () => {
      const r = parseQuickAdd('Buy milk tomorrow @shopping !2 +alice #Personal', NOW, 'todoist');
      expect(r.title).toBe('Buy milk');
      expect(r.labelTitles).toEqual(['shopping']);
      expect(r.projectTitle).toBe('Personal');
      expect(r.assigneeUsernames).toEqual(['alice']);
      expect(r.priority).toBe(2);
      expect(r.dueDate).not.toBeNull();
    });

    it('supports quoted labels and projects, straight or curly', () => {
      const r = parseQuickAdd('Plan trip @"south africa" #“Work Projects”', NOW, 'todoist');
      expect(r.title).toBe('Plan trip');
      expect(r.labelTitles).toEqual(['south africa']);
      expect(r.projectTitle).toBe('Work Projects');
    });

    it('previews unterminated quoted labels and projects', () => {
      expect(parseQuickAdd('Plan trip @"two wo', NOW, 'todoist').labelTitles).toEqual(['two wo']);
      expect(parseQuickAdd('Plan trip #"Work St', NOW, 'todoist').projectTitle).toBe('Work St');
    });

    it('leaves the vikunja-only symbol as title text', () => {
      const r = parseQuickAdd('Fix *bug', NOW, 'todoist');
      expect(r.title).toBe('Fix *bug');
      expect(r.labelTitles).toEqual([]);
    });

    it('does not chip symbols inside words', () => {
      const r = parseQuickAdd('Learn C# and email me@home.com', NOW, 'todoist');
      expect(r.title).toBe('Learn C# and email me@home.com');
      expect(r.projectTitle).toBeNull();
      expect(r.labelTitles).toEqual([]);
    });

    it('labels each preview token by its todoist meaning', () => {
      const r = parseQuickAdd('Ship @v2 +bob #Dev', NOW, 'todoist');
      expect(r.tokens.filter((t) => t.kind !== 'text').map((t) => [t.kind, t.text])).toEqual([
        ['label', '@v2'],
        ['assignee', '+bob'],
        ['project', '#Dev'],
      ]);
    });
  });

  describe('disabled', () => {
    it('keeps the whole input as the title', () => {
      const line = 'Buy milk tomorrow *shopping !2 @alice +Personal every day';
      const r = parseQuickAdd(line, NOW, 'disabled');
      expect(r.title).toBe(line);
      expect(r.dueDate).toBeNull();
      expect(r.priority).toBeNull();
      expect(r.labelTitles).toEqual([]);
      expect(r.assigneeUsernames).toEqual([]);
      expect(r.projectTitle).toBeNull();
      expect(r.repeatAfter).toBeNull();
      expect(r.repeatMode).toBeNull();
    });

    it('keeps inner spacing verbatim and returns one text token, none for empty input', () => {
      // Vikunja-web returns the text untouched in this mode; Cria trims the ends only.
      expect(parseQuickAdd('  Call  mum ', NOW, 'disabled')).toMatchObject({
        title: 'Call  mum',
        tokens: [{ kind: 'text', start: 0, end: 12, text: '  Call  mum ' }],
      });
      expect(parseQuickAdd('', NOW, 'disabled').tokens).toEqual([]);
    });
  });
});

// Ported from Vikunja-web's quickAddMagic.test.ts ("Quote-escaped text").
describe('quoted input is a literal title', () => {
  const NOTHING_PARSED = {
    dueDate: null,
    priority: null,
    labelTitles: [],
    assigneeUsernames: [],
    projectTitle: null,
    repeatAfter: null,
    repeatMode: null,
  };

  it('skips all parsing when the input is wrapped in double quotes', () => {
    expect(parseQuickAdd('"delete mails up to january 30th"', NOW)).toMatchObject({
      title: 'delete mails up to january 30th',
      ...NOTHING_PARSED,
    });
  });

  it('skips all parsing when the input is wrapped in single quotes', () => {
    expect(parseQuickAdd("'buy mass tomorrow *label !2 @user'", NOW)).toMatchObject({
      title: 'buy mass tomorrow *label !2 @user',
      ...NOTHING_PARSED,
    });
  });

  // Cria-only: iOS Smart Punctuation and macOS smart quotes type curly pairs.
  it('accepts curly double and single quote pairs', () => {
    expect(parseQuickAdd('“buy mass tomorrow *label !2”', NOW)).toMatchObject({
      title: 'buy mass tomorrow *label !2',
      ...NOTHING_PARSED,
    });
    expect(parseQuickAdd('‘buy mass tomorrow’', NOW)).toMatchObject({
      title: 'buy mass tomorrow',
      ...NOTHING_PARSED,
    });
  });

  it('does not treat a curly opening quote with a straight close as a pair', () => {
    expect(parseQuickAdd('“delete mails today"', NOW).dueDate).not.toBeNull();
  });

  it('parses as usual for an unmatched quote', () => {
    expect(parseQuickAdd('"delete mails today', NOW).dueDate).not.toBeNull();
  });

  it('parses as usual for mismatched quote types', () => {
    expect(parseQuickAdd('"delete mails today\'', NOW).dueDate).not.toBeNull();
  });

  it('parses as usual when the quotes are in the middle', () => {
    expect(parseQuickAdd('delete "mails" today', NOW).dueDate).not.toBeNull();
  });

  it('handles an empty quoted string', () => {
    expect(parseQuickAdd('""', NOW)).toMatchObject({ title: '', dueDate: null });
  });

  it('skips parsing in todoist mode too', () => {
    expect(parseQuickAdd('"task today @label #project"', NOW, 'todoist')).toMatchObject({
      title: 'task today @label #project',
      ...NOTHING_PARSED,
    });
  });

  // Upstream checks the quotes before the mode, so they are dropped with the magic off too.
  it.each(['vikunja', 'todoist', 'disabled'] as const)('drops the pair and parses nothing in %s mode', (mode) => {
    const inner = 'Buy milk tomorrow *shop @alice +Home #Work !2 every day';
    expect(parseQuickAdd(`"${inner}"`, NOW, mode)).toMatchObject({ title: inner, ...NOTHING_PARSED });
    expect(parseQuickAdd(`'${inner}'`, NOW, mode)).toMatchObject({ title: inner, ...NOTHING_PARSED });
    expect(parseQuickAdd("''", NOW, mode).title).toBe('');
  });

  it('keeps the quotes as text with the magic off when they do not wrap the input', () => {
    expect(parseQuickAdd('"Lorem ipsum', NOW, 'disabled').title).toBe('"Lorem ipsum');
    expect(parseQuickAdd('"Lorem ipsum\'', NOW, 'disabled').title).toBe('"Lorem ipsum\'');
  });

  it('checks only the first and last characters, so inner quotes stay', () => {
    expect(parseQuickAdd('"Read "Dune" tomorrow"', NOW)).toMatchObject({
      title: 'Read "Dune" tomorrow',
      dueDate: null,
    });
    expect(parseQuickAdd('"Plan" *trip "now"', NOW)).toMatchObject({ title: 'Plan" *trip "now', labelTitles: [] });
  });

  it('needs a pair: a lone quote is title text', () => {
    expect(parseQuickAdd('"', NOW).title).toBe('"');
  });

  it('ignores surrounding whitespace, keeps inner spacing and previews the input as one text token', () => {
    const raw = '  " Call  mum tomorrow " ';
    expect(parseQuickAdd(raw, NOW)).toMatchObject({
      title: 'Call  mum tomorrow',
      dueDate: null,
      tokens: [{ kind: 'text', start: 0, end: raw.length, text: raw }],
    });
  });
});

// Ported from Vikunja-web's useQuickAddTask and helpers/task tests: a title
// that is only magic stays a literal title, and nothing parsed from it applies.
describe('parseQuickAddTask', () => {
  const NOTHING_PARSED = {
    dueDate: null,
    priority: null,
    labelTitles: [],
    assigneeUsernames: [],
    projectTitle: null,
    repeatAfter: null,
    repeatMode: null,
  };

  it('creates no label when the whole title is magic', () => {
    expect(parseQuickAddTask('*Urgent', NOW)).toMatchObject({ title: '*Urgent', ...NOTHING_PARSED });
  });

  it('keeps a title that is only a project prefix, without moving the task', () => {
    expect(parseQuickAddTask('+Other', NOW)).toMatchObject({ title: '+Other', ...NOTHING_PARSED });
  });

  it('keeps the raw input title, trimmed, when the magic parses no text', () => {
    const raw = ' *label ';
    expect(parseQuickAddTask(raw, NOW)).toMatchObject({
      title: '*label',
      ...NOTHING_PARSED,
      tokens: [{ kind: 'text', start: 0, end: raw.length, text: raw }],
    });
  });

  it('keeps a lone date, repeat or priority as text', () => {
    expect(parseQuickAddTask('tomorrow', NOW)).toMatchObject({ title: 'tomorrow', ...NOTHING_PARSED });
    expect(parseQuickAddTask('every day', NOW)).toMatchObject({ title: 'every day', ...NOTHING_PARSED });
    expect(parseQuickAddTask('!3', NOW)).toMatchObject({ title: '!3', ...NOTHING_PARSED });
  });

  it.each([
    ['vikunja', '*errands +Home @alice !3 tomorrow every day'],
    ['todoist', '@errands #Home +alice !3 tomorrow every day'],
    ['disabled', '*errands +Home @alice !3 tomorrow every day'],
  ] as const)('keeps a line of only tokens as typed in %s mode', (mode, line) => {
    expect(parseQuickAddTask(line, NOW, mode)).toMatchObject({ title: line, ...NOTHING_PARSED });
  });

  it.each(['vikunja', 'todoist', 'disabled'] as const)('keeps an empty quoted pair as typed in %s mode', (mode) => {
    expect(parseQuickAddTask('""', NOW, mode)).toMatchObject({ title: '""', ...NOTHING_PARSED });
    expect(parseQuickAddTask("''", NOW, mode).title).toBe("''");
  });

  // Upstream sends the blank inside as the title, which the server rejects;
  // Cria treats it like an empty pair instead.
  it('keeps a quoted pair around only whitespace as typed', () => {
    expect(parseQuickAddTask('"  "', NOW).title).toBe('"  "');
  });

  it('matches parseQuickAdd when the line has a title', () => {
    for (const line of ['Buy milk *shop +Home tomorrow !2', '"*shop"', 'Buy milk']) {
      expect(parseQuickAddTask(line, NOW)).toEqual(parseQuickAdd(line, NOW));
    }
    expect(parseQuickAddTask('Buy milk @shop #Home', NOW, 'todoist')).toEqual(
      parseQuickAdd('Buy milk @shop #Home', NOW, 'todoist'),
    );
  });

  it('leaves blank input without a title', () => {
    expect(parseQuickAddTask('', NOW)).toMatchObject({ title: '', tokens: [] });
    expect(parseQuickAddTask('   ', NOW).title).toBe('');
  });
});
