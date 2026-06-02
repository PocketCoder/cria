/**
 * Natural-language quick-add parser, in the Vikunja-web style.
 *
 *   "Buy milk tomorrow at 5pm @groceries !2 +alice #Personal"
 *
 * is parsed into:
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
 * Token rules (a "token" here is a substring of the input that
 * contributes to a non-title field; everything else is title text):
 *
 *   @label      — `@` followed by one or more of `[A-Za-z0-9_-]` and
 *                 optionally extended with inner spaces via the quoted
 *                 form `@"two words"`. Multiple `@` tokens accumulate.
 *   !priority   — `!` followed by a digit `1`..`5`. Highest wins if the
 *                 user wrote several.
 *   +assignee   — `+` followed by `[A-Za-z0-9_-]`. Multiple accumulate.
 *   #project    — `#` followed by a project name (same quoting as labels).
 *                 Only one project token is kept (last wins).
 *   <date>      — *anywhere*, parsed by chrono-node. We take the first
 *                 non-empty result.
 */

import * as chrono from 'chrono-node';

export interface QuickAddResult {
  title: string;
  dueDate: string | null;
  priority: number | null;
  labelTitles: string[];
  assigneeUsernames: string[];
  projectTitle: string | null;
  tokens: QuickAddToken[];
}

export type QuickAddToken =
  | { kind: 'text'; start: number; end: number; text: string }
  | { kind: 'date'; start: number; end: number; text: string; iso: string }
  | { kind: 'priority'; start: number; end: number; text: string; value: number }
  | { kind: 'label'; start: number; end: number; text: string; title: string }
  | { kind: 'assignee'; start: number; end: number; text: string; username: string }
  | { kind: 'project'; start: number; end: number; text: string; title: string };

// Vikunja's *default* Quick Add Magic prefixes
// (pkg frontend: src/modules/quickAddMagic/prefixes.ts → VIKUNJA_PREFIXES):
//   label '*'  project '+'  assignee '@'  priority '!'
// (Vikunja's Todoist mode swaps these to @ / # / + — see issue tracking
// making the mode user-selectable + synced with the user's Vikunja-web
// setting.)
// Quote class accepts straight (") and macOS "smart" curly quotes
// (“ ”), which text inputs substitute by default — otherwise
// `*"two words"` typed in the app wouldn't match.
const LABEL_RE = /(?:^|\s)(\*["“”][^"“”]+["“”]|\*[A-Za-z0-9_-]+)(?=\s|$)/g;
const PROJECT_RE = /(?:^|\s)(\+["“”][^"“”]+["“”]|\+[A-Za-z0-9_-]+)(?=\s|$)/g;
const ASSIGNEE_RE = /(?:^|\s)(@[A-Za-z0-9_-]+)(?=\s|$)/g;
const PRIORITY_RE = /(?:^|\s)(![1-5])(?=\s|$)/g;

interface RawToken {
  kind: 'label' | 'project' | 'priority' | 'assignee' | 'date';
  start: number;
  end: number;
  text: string;
  payload: string | number;
  iso?: string;
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

export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddResult {
  const raw = input;
  const claimed: RawToken[] = [];

  // --- Symbol tokens first (cheap, unambiguous) ---

  for (const m of raw.matchAll(LABEL_RE)) {
    const matchText = m[1]!;
    const start = m.index! + (m[0]!.length - matchText.length);
    const end = start + matchText.length;
    const title = parseQuoted(matchText, '*');
    if (title.length > 0) {
      claimed.push({ kind: 'label', start, end, text: matchText, payload: title });
    }
  }

  for (const m of raw.matchAll(PRIORITY_RE)) {
    const matchText = m[1]!;
    const start = m.index! + (m[0]!.length - matchText.length);
    const end = start + matchText.length;
    const value = parseInt(matchText.slice(1), 10);
    claimed.push({ kind: 'priority', start, end, text: matchText, payload: value });
  }

  for (const m of raw.matchAll(ASSIGNEE_RE)) {
    const matchText = m[1]!;
    const start = m.index! + (m[0]!.length - matchText.length);
    const end = start + matchText.length;
    const username = matchText.slice(1);
    claimed.push({ kind: 'assignee', start, end, text: matchText, payload: username });
  }

  for (const m of raw.matchAll(PROJECT_RE)) {
    const matchText = m[1]!;
    const start = m.index! + (m[0]!.length - matchText.length);
    const end = start + matchText.length;
    const title = parseQuoted(matchText, '+');
    if (title.length > 0) {
      claimed.push({ kind: 'project', start, end, text: matchText, payload: title });
    }
  }

  // --- Date (chrono-node) — skip ranges already claimed by symbol tokens ---

  const chronoResults = chrono.parse(raw, now, { forwardDate: true });
  for (const r of chronoResults) {
    const start = r.index;
    const end = r.index + r.text.length;
    if (overlaps(start, end, claimed)) continue;
    const date = r.start.date();
    claimed.push({
      kind: 'date',
      start,
      end,
      text: r.text,
      payload: 0,
      iso: date.toISOString(),
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
  for (const t of claimed) {
    if (t.kind === 'label') labelTitles.push(t.payload as string);
    else if (t.kind === 'assignee') assigneeUsernames.push(t.payload as string);
    else if (t.kind === 'project') projectTitle = t.payload as string;
    else if (t.kind === 'priority') {
      priority = priority === null ? (t.payload as number) : Math.max(priority, t.payload as number);
    } else if (t.kind === 'date' && t.iso && !dueDate) {
      dueDate = t.iso;
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
    }
    walk = t.end;
  }
  if (walk < raw.length) {
    tokens.push({ kind: 'text', start: walk, end: raw.length, text: raw.slice(walk) });
  }

  return { title, dueDate, priority, labelTitles, assigneeUsernames, projectTitle, tokens };
}

function overlaps(start: number, end: number, ranges: RawToken[]): boolean {
  for (const r of ranges) {
    if (start < r.end && end > r.start) return true;
  }
  return false;
}
