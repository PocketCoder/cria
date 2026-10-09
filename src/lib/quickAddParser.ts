/**
 * Natural-language quick-add parser, in the Vikunja-web style.
 *
 *   "Buy milk tomorrow at 5pm *groceries !2 @alice +Personal"
 *
 * is parsed (in the default `vikunja` mode) into:
 *
 *   {
 *     title: "Buy milk",
 *     dueDate: <ISO for tomorrow 17:00 local>,
 *     priority: 2,
 *     labelTitles: ["groceries"],
 *     assigneeUsernames: ["alice"],
 *     projectTitle: "Personal",
 *     tokens: [...]   // for live preview rendering
 *   }
 *
 * Pure function — no DB, no React, no Tauri. Trivially unit-testable.
 *
 * The symbols depend on the Quick Add Magic mode (see quickAddPrefixes):
 *
 *   mode      label  project  assignee  priority
 *   vikunja   *      +        @         !
 *   todoist   @      #        +         !
 *   disabled  no parsing at all: the whole input is the title
 *
 * Token rules (a "token" here is a substring of the input that
 * contributes to a non-title field; everything else is title text):
 *
 *   label       — prefix followed by one or more of `[A-Za-z0-9_-]`, or the
 *                 quoted form `*"two words"`. Multiple labels accumulate.
 *   priority    — prefix followed by a digit `1`..`5`. Highest wins if the
 *                 user wrote several.
 *   assignee    — prefix followed by `[A-Za-z0-9_-]`. Multiple accumulate.
 *   project     — prefix followed by a project name (same quoting as
 *                 labels). Only one project token is kept (last wins).
 *   <recurrence> — "every 2 weeks", "daily", "every monday"…
 *   <date>      — *anywhere*, parsed by chrono-node. We take the first
 *                 non-empty result.
 *
 * Input wrapped entirely in a pair of straight double or single quotes is a
 * literal title in every mode, as in Vikunja-web: the pair is dropped and
 * nothing inside it is parsed (see `unquoteLiteral`).
 */

import * as chrono from 'chrono-node';
import { timedIso } from '@/lib/dateFormat';
import {
  DEFAULT_QUICK_ADD_MAGIC_MODE,
  QUICK_ADD_PREFIXES,
  type QuickAddMagicMode,
  type QuickAddPrefixes,
} from '@/lib/quickAddPrefixes';

export interface QuickAddResult {
  title: string;
  dueDate: string | null;
  priority: number | null;
  labelTitles: string[];
  assigneeUsernames: string[];
  projectTitle: string | null;
  repeatAfter: number | null;
  repeatMode: number | null;
  tokens: QuickAddToken[];
}

export type QuickAddToken =
  | { kind: 'text'; start: number; end: number; text: string }
  | { kind: 'date'; start: number; end: number; text: string; iso: string }
  | { kind: 'priority'; start: number; end: number; text: string; value: number }
  | { kind: 'label'; start: number; end: number; text: string; title: string }
  | { kind: 'assignee'; start: number; end: number; text: string; username: string }
  | { kind: 'project'; start: number; end: number; text: string; title: string }
  | { kind: 'recurrence'; start: number; end: number; text: string; repeatAfter: number | null; repeatMode: number | null };

// Quote class accepts straight (") and macOS "smart" curly quotes
// (“ ”), which text inputs substitute by default — otherwise
// `*"two words"` typed in the app wouldn't match.
// The unquoted class is shared with `needsQuoting` below so the two can't drift.
const BARE_NAME = '[A-Za-z0-9_-]+';

interface PrefixRegexes {
  prefixes: QuickAddPrefixes;
  label: RegExp;
  project: RegExp;
  assignee: RegExp;
  priority: RegExp;
  /** An opening quote after the label/project prefix running to end-of-input. */
  openQuote: RegExp;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegexes(prefixes: QuickAddPrefixes): PrefixRegexes {
  const quotable = (prefix: string) => {
    const p = escapeRe(prefix);
    return new RegExp(`(?:^|\\s)(${p}["“”][^"“”]+["“”]|${p}${BARE_NAME})(?=\\s|$)`, 'g');
  };
  return {
    prefixes,
    label: quotable(prefixes.label),
    project: quotable(prefixes.project),
    assignee: new RegExp(`(?:^|\\s)(${escapeRe(prefixes.assignee)}${BARE_NAME})(?=\\s|$)`, 'g'),
    priority: new RegExp(`(?:^|\\s)(${escapeRe(prefixes.priority)}[1-5])(?=\\s|$)`, 'g'),
    openQuote: new RegExp(
      `(?:^|\\s)(${escapeRe(prefixes.label)}|${escapeRe(prefixes.project)})(["“”])([^"“”]*)$`,
    ),
  };
}

const REGEX_CACHE = new Map<QuickAddMagicMode, PrefixRegexes>();

/** The mode's compiled token regexes, or null when the mode parses nothing. */
function regexesFor(mode: QuickAddMagicMode): PrefixRegexes | null {
  const prefixes = QUICK_ADD_PREFIXES[mode];
  if (!prefixes) return null;
  let regexes = REGEX_CACHE.get(mode);
  if (!regexes) {
    regexes = buildRegexes(prefixes);
    REGEX_CACHE.set(mode, regexes);
  }
  return regexes;
}

// Recurrence phrases. Must be checked before chrono-date so "every monday"
// is consumed here and not by chrono-node.
const RECURRENCE_RE = /(?:^|\s)((?:every\s+\d+\s+(?:day|week|month|year|hour)s?|every\s+(?:day|week|month|year|hour)|(?:daily|weekly|monthly|yearly|hourly)|every\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)))(?=\s|$)/gi;

const SECONDS = { day: 86400, week: 604800, month: 2592000, year: 31536000, hour: 3600 } as const;

function parseRecurrence(text: string): { repeatAfter: number | null; repeatMode: number | null } | null {
  const lower = text.toLowerCase();
  // "every N <unit>"
  const nUnit = lower.match(/^every\s+(\d+)\s+(day|week|month|year|hour)s?$/);
  if (nUnit) {
    const n = parseInt(nUnit[1]!, 10);
    const unit = nUnit[2]!;
    if (unit === 'month') {
      // Vikunja's monthly mode (repeat_mode 1) ignores repeat_after, so it can
      // only express "every month". "every N months" (N > 1) is approximated as
      // N x 30 days, the same model the inspector's month unit uses, rather
      // than silently collapsing to monthly and dropping the N.
      if (n === 1) return { repeatAfter: null, repeatMode: 1 };
      return { repeatAfter: n * SECONDS.month, repeatMode: 0 };
    }
    if (unit in SECONDS) return { repeatAfter: n * SECONDS[unit as keyof typeof SECONDS], repeatMode: 0 };
    return { repeatAfter: null, repeatMode: null };
  }
  // "every <day-of-week>"
  if (/^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(lower)) {
    return { repeatAfter: SECONDS.week, repeatMode: 0 };
  }
  // "every <unit>" / standalone keyword
  if (lower === 'every day' || lower === 'daily') return { repeatAfter: SECONDS.day, repeatMode: 0 };
  if (lower === 'every week' || lower === 'weekly') return { repeatAfter: SECONDS.week, repeatMode: 0 };
  if (lower === 'every hour' || lower === 'hourly') return { repeatAfter: SECONDS.hour, repeatMode: 0 };
  if (lower === 'every month' || lower === 'monthly') return { repeatAfter: null, repeatMode: 1 };
  if (lower === 'every year' || lower === 'yearly') return { repeatAfter: SECONDS.year, repeatMode: 0 };
  return null;
}

interface RawToken {
  kind: 'label' | 'project' | 'priority' | 'assignee' | 'date' | 'recurrence';
  start: number;
  end: number;
  text: string;
  /** Field-typed payload — narrowed when converted to QuickAddToken. */
  payload: string | number | { repeatAfter: number | null; repeatMode: number | null };
  /** For date tokens only: the ISO timestamp the date phrase resolves to. */
  iso?: string;
}

/**
 * True when a project/label name can't be written bare after `+` / `*` and
 * must use the quoted form (`+"Mum's"`): anything outside the unquoted class,
 * e.g. spaces, accents or apostrophes. Apostrophes are fine inside quotes; only
 * double quotes can't be expressed at all.
 */
export function needsQuoting(name: string): boolean {
  return !new RegExp(`^${BARE_NAME}$`).test(name);
}

function parseQuoted(raw: string, prefix: string): string {
  const afterPrefix = raw.slice(prefix.length);
  // Strip a surrounding double-quote pair — straight or smart, in any
  // open/close combination (e.g. “…”, "…", “…").
  if (afterPrefix.length >= 2 && /^["“”].*["“”]$/.test(afterPrefix)) {
    return afterPrefix.slice(1, -1).trim();
  }
  return afterPrefix;
}

/**
 * Vikunja-web's escape from the magic (`parseTaskText`): input that starts and
 * ends with the same straight quote, `"` or `'`, is a literal title. Only the
 * first and last characters are checked, as upstream does, so inner quotes
 * stay as typed. Returns the text inside the pair, or null when the input
 * isn't wrapped. Unlike upstream, surrounding whitespace is ignored, since
 * Cria trims every title's ends anyway.
 */
function unquoteLiteral(input: string): string | null {
  const text = input.trim();
  const quote = text[0];
  if (text.length >= 2 && (quote === '"' || quote === "'") && text.endsWith(quote)) {
    return text.slice(1, -1);
  }
  return null;
}

/**
 * Parse a quick-add line. `mode` picks the prefix table; `disabled` mirrors
 * Vikunja-web, which turns the magic off entirely: no symbols, dates or
 * recurrence, so the whole input becomes the title.
 */
export function parseQuickAdd(
  input: string,
  now: Date = new Date(),
  mode: QuickAddMagicMode = DEFAULT_QUICK_ADD_MAGIC_MODE,
): QuickAddResult {
  const raw = input;
  // Checked before the mode, as upstream does, so it applies with the magic off too.
  const literal = unquoteLiteral(raw);
  if (literal !== null) return plainTitle(raw, literal);
  const re = regexesFor(mode);
  if (!re) return plainTitle(raw);
  const { prefixes } = re;
  const claimed: RawToken[] = [];

  // --- Symbol tokens first (cheap, unambiguous) ---

  for (const m of raw.matchAll(re.label)) {
    const matchText = m[1]!;
    const start = m.index! + (m[0]!.length - matchText.length);
    const end = start + matchText.length;
    const title = parseQuoted(matchText, prefixes.label);
    if (title.length > 0) {
      claimed.push({ kind: 'label', start, end, text: matchText, payload: title });
    }
  }

  for (const m of raw.matchAll(re.priority)) {
    const matchText = m[1]!;
    const start = m.index! + (m[0]!.length - matchText.length);
    const end = start + matchText.length;
    const value = parseInt(matchText.slice(prefixes.priority.length), 10);
    claimed.push({ kind: 'priority', start, end, text: matchText, payload: value });
  }

  for (const m of raw.matchAll(re.assignee)) {
    const matchText = m[1]!;
    const start = m.index! + (m[0]!.length - matchText.length);
    const end = start + matchText.length;
    const username = matchText.slice(prefixes.assignee.length);
    claimed.push({ kind: 'assignee', start, end, text: matchText, payload: username });
  }

  for (const m of raw.matchAll(re.project)) {
    const matchText = m[1]!;
    const start = m.index! + (m[0]!.length - matchText.length);
    const end = start + matchText.length;
    const title = parseQuoted(matchText, prefixes.project);
    if (title.length > 0) {
      claimed.push({ kind: 'project', start, end, text: matchText, payload: title });
    }
  }

  // --- Recurrence — before chrono-date so "every monday" is claimed first ---

  for (const m of raw.matchAll(RECURRENCE_RE)) {
    const matchText = m[1]!;
    const start = m.index! + (m[0]!.length - matchText.length);
    const end = start + matchText.length;
    const parsed = parseRecurrence(matchText);
    if (parsed && !overlaps(start, end, claimed)) {
      claimed.push({
        kind: 'recurrence',
        start,
        end,
        text: matchText,
        payload: parsed,
      });
    }
  }

  // --- Unterminated quoted token at end-of-input (live preview) ---
  // While the user is mid-typing `*"two words` (a label or project prefix,
  // no closing quote yet) the balanced-pair regexes above can't match, so the
  // chip wouldn't appear until the final quote. Recognise an opening quote that runs to the end
  // of the string so the chip shows as they type; once they add the closing
  // quote the balanced form takes over with the same payload.
  {
    const m = re.openQuote.exec(raw);
    if (m) {
      const prefix = m[1]!;
      const tokenText = prefix + m[2]! + m[3]!;
      const start = m.index + (m[0]!.length - tokenText.length);
      const end = raw.length;
      const title = m[3]!.trim();
      if (title.length > 0 && !overlaps(start, end, claimed)) {
        claimed.push({
          kind: prefix === prefixes.label ? 'label' : 'project',
          start,
          end,
          text: tokenText,
          payload: title,
        });
      }
    }
  }

  // --- Date (chrono-node) — skip ranges already claimed by symbol tokens ---

  const chronoResults = chrono.parse(raw, now, { forwardDate: true });
  for (const r of chronoResults) {
    const start = r.index;
    const end = r.index + r.text.length;
    if (overlaps(start, end, claimed)) continue;
    const date = r.start.date();
    // Only a phrase that named a time of day ("at 5pm", "17:00") is "timed";
    // a bare date ("tomorrow") is all-day. chrono otherwise fills the hour
    // from `now`, which would leak the current clock time onto every date.
    // All-day → UTC midnight of the calendar day (matches DatePicker); timed →
    // local datetime ISO.
    const timed = r.start.isCertain('hour');
    const iso = timed
      ? timedIso(date)
      : new Date(
          Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
        ).toISOString();
    claimed.push({
      kind: 'date',
      start,
      end,
      text: r.text,
      payload: 0,
      iso,
    });
    break;
  }

  // --- Build the title by stripping claimed ranges ---

  claimed.sort((a, b) => a.start - b.start);
  let title = '';
  let cursor = 0;
  for (const t of claimed) {
    if (t.start > cursor) title += raw.slice(cursor, t.start);
    cursor = t.end;
  }
  if (cursor < raw.length) title += raw.slice(cursor);
  title = title.replace(/\s+/g, ' ').trim();

  // --- Aggregate fields ---

  const labelTitles: string[] = [];
  const assigneeUsernames: string[] = [];
  let priority: number | null = null;
  let dueDate: string | null = null;
  let projectTitle: string | null = null;
  let repeatAfter: number | null = null;
  let repeatMode: number | null = null;
  for (const t of claimed) {
    if (t.kind === 'label') labelTitles.push(t.payload as string);
    else if (t.kind === 'assignee') assigneeUsernames.push(t.payload as string);
    else if (t.kind === 'project') projectTitle = t.payload as string;
    else if (t.kind === 'priority') {
      priority = priority === null ? (t.payload as number) : Math.max(priority, t.payload as number);
    } else if (t.kind === 'date' && t.iso && !dueDate) {
      dueDate = t.iso;
    } else if (t.kind === 'recurrence') {
      const p = t.payload as { repeatAfter: number | null; repeatMode: number | null };
      if (!repeatAfter) repeatAfter = p.repeatAfter;
      if (!repeatMode) repeatMode = p.repeatMode;
    }
  }

  // --- Build the full token list (interleaving text segments) ---

  const tokens: QuickAddToken[] = [];
  let walk = 0;
  for (const t of claimed) {
    if (t.start > walk) {
      const text = raw.slice(walk, t.start);
      if (text.length > 0) tokens.push({ kind: 'text', start: walk, end: t.start, text });
    }
    if (t.kind === 'label') {
      tokens.push({ kind: 'label', start: t.start, end: t.end, text: t.text, title: t.payload as string });
    } else if (t.kind === 'project') {
      tokens.push({ kind: 'project', start: t.start, end: t.end, text: t.text, title: t.payload as string });
    } else if (t.kind === 'priority') {
      tokens.push({ kind: 'priority', start: t.start, end: t.end, text: t.text, value: t.payload as number });
    } else if (t.kind === 'assignee') {
      tokens.push({ kind: 'assignee', start: t.start, end: t.end, text: t.text, username: t.payload as string });
    } else if (t.kind === 'date' && t.iso) {
      tokens.push({ kind: 'date', start: t.start, end: t.end, text: t.text, iso: t.iso });
    } else if (t.kind === 'recurrence') {
      const p = t.payload as { repeatAfter: number | null; repeatMode: number | null };
      tokens.push({ kind: 'recurrence', start: t.start, end: t.end, text: t.text, repeatAfter: p.repeatAfter, repeatMode: p.repeatMode });
    }
    walk = t.end;
  }
  if (walk < raw.length) {
    tokens.push({ kind: 'text', start: walk, end: raw.length, text: raw.slice(walk) });
  }

  return { title, dueDate, priority, labelTitles, assigneeUsernames, projectTitle, repeatAfter, repeatMode, tokens };
}

/**
 * A literal title: nothing is parsed, matching Vikunja-web's `parseTaskText`,
 * which returns the text verbatim (`disabled` mode) or without its quotes
 * (quoted input). Only the ends are trimmed, so a blank line still reads as
 * "no title"; inner spacing is kept as typed. The preview shows the whole
 * input, quotes included, as plain text.
 */
function plainTitle(raw: string, title: string = raw): QuickAddResult {
  return {
    title: title.trim(),
    dueDate: null,
    priority: null,
    labelTitles: [],
    assigneeUsernames: [],
    projectTitle: null,
    repeatAfter: null,
    repeatMode: null,
    tokens: raw.length > 0 ? [{ kind: 'text', start: 0, end: raw.length, text: raw }] : [],
  };
}

function overlaps(start: number, end: number, ranges: RawToken[]): boolean {
  for (const r of ranges) {
    if (start < r.end && end > r.start) return true;
  }
  return false;
}
