/**
 * Natural-language quick-add parser, in the Todoist style.
 *
 *   "Buy milk tomorrow at 5pm #shopping !2 @alice"
 *
 * is parsed into:
 *
 *   {
 *     title: "Buy milk",
 *     dueDate: <ISO for tomorrow 17:00 local>,
 *     priority: 2,
 *     labelTitles: ["shopping"],
 *     assigneeUsernames: ["alice"],
 *     tokens: [...]   // for live preview rendering
 *   }
 *
 * Pure function — no DB, no React, no Tauri. Trivially unit-testable.
 *
 * Token rules (a "token" here is a substring of the input that
 * contributes to a non-title field; everything else is title text):
 *
 *   #label      — `#` followed by one or more of `[A-Za-z0-9_-]` and
 *                 optionally extended with single inner spaces if the
 *                 user wrote `#"two words"` (quoted form). Multiple `#`
 *                 tokens accumulate.
 *   !priority   — `!` followed by a digit `1`..`5`. Highest wins if the
 *                 user wrote several.
 *   @assignee   — `@` followed by `[A-Za-z0-9_-]`. Multiple accumulate.
 *   <date>      — *anywhere*, parsed by chrono-node. We take the first
 *                 non-empty result.
 *
 * Anything that doesn't match one of the above stays in the title.
 * Whitespace around stripped tokens is collapsed.
 */

import * as chrono from 'chrono-node';

export interface QuickAddResult {
  title: string;
  dueDate: string | null;
  priority: number | null;
  repeatAfter: number;
  repeatMode: number;
  labelTitles: string[];
  assigneeUsernames: string[];
  tokens: QuickAddToken[];
}

export type QuickAddToken =
  | { kind: 'text'; start: number; end: number; text: string }
  | { kind: 'date'; start: number; end: number; text: string; iso: string }
  | { kind: 'priority'; start: number; end: number; text: string; value: number }
  | { kind: 'label'; start: number; end: number; text: string; title: string }
  | { kind: 'assignee'; start: number; end: number; text: string; username: string }
  | { kind: 'recurrence'; start: number; end: number; text: string; repeatAfter: number; repeatMode: number };

// Regex source-of-truth for the symbol tokens. Kept narrow on purpose so
// the title can contain `#` / `!` / `@` characters mid-word and only the
// recognised forms get stripped.
const LABEL_RE = /(?:^|\s)(#"[^"]+"|#[A-Za-z0-9_-]+)(?=\s|$)/g;
const PRIORITY_RE = /(?:^|\s)(![1-5])(?=\s|$)/g;
const ASSIGNEE_RE = /(?:^|\s)(@[A-Za-z0-9_-]+)(?=\s|$)/g;
const RECURRENCE_RE = /(?:^|\s)(every\s+\d+\s+(day|week|month|year)s?|every\s+(day|week|month|year)s?|daily|weekly|monthly|yearly)(?=\s|$)/gi;

interface RawToken {
  kind: 'label' | 'priority' | 'assignee' | 'date' | 'recurrence';
  start: number;
  end: number;
  text: string;
  /** Field-typed payload — narrowed when converted to QuickAddToken. */
  payload: string | number;
  /** For date tokens only: the ISO timestamp the date phrase resolves to. */
  iso?: string;
  /** For recurrence tokens only. */
  repeatAfter?: number;
  repeatMode?: number;
}

export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddResult {
  const raw = input;
  const claimed: RawToken[] = [];

  // --- Symbol tokens first (cheap, unambiguous) ---

  for (const m of raw.matchAll(LABEL_RE)) {
    const matchText = m[1]!;
    const start = m.index! + (m[0]!.length - matchText.length);
    const end = start + matchText.length;
    const title = matchText.startsWith('#"')
      ? matchText.slice(2, -1).trim()
      : matchText.slice(1);
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

  // --- Recurrence (before chrono so "every day" doesn't leak as a date) ---
  //
  // Patterns: "every day", "every 3 days", "daily", "weekly", "monthly",
  // "every month", "every 2 weeks", "every year", etc.

  for (const m of raw.matchAll(RECURRENCE_RE)) {
    const matchText = m[1]!;
    const start = m.index! + (m[0]!.length - matchText.length);
    const end = start + matchText.length;
    if (overlaps(start, end, claimed)) continue;
    const parsed = parseRecurrenceText(matchText);
    if (parsed) {
      claimed.push({
        kind: 'recurrence',
        start,
        end,
        text: matchText,
        payload: 0,
        repeatAfter: parsed.repeatAfter,
        repeatMode: parsed.repeatMode,
      });
    }
  }

  // --- Date (chrono-node) — skip ranges already claimed by symbol tokens ---
  //
  // chrono will happily match "tomorrow" anywhere; we let it run on the
  // full string, then drop any result that overlaps a symbol token (in
  // practice this rarely happens but guards against e.g. "@friday").

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
      payload: 0, // unused for dates
      iso: date.toISOString(),
    });
    break; // first date wins; second timestamp would just confuse the title
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
  let repeatAfter = 0;
  let repeatMode = 0;
  for (const t of claimed) {
    if (t.kind === 'label') labelTitles.push(t.payload as string);
    else if (t.kind === 'assignee') assigneeUsernames.push(t.payload as string);
    else if (t.kind === 'priority') {
      priority = priority === null ? (t.payload as number) : Math.max(priority, t.payload as number);
    } else if (t.kind === 'date' && t.iso && !dueDate) {
      dueDate = t.iso;
    } else if (t.kind === 'recurrence') {
      repeatAfter = t.repeatAfter ?? 0;
      repeatMode = t.repeatMode ?? 0;
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
    } else if (t.kind === 'priority') {
      tokens.push({ kind: 'priority', start: t.start, end: t.end, text: t.text, value: t.payload as number });
    } else if (t.kind === 'assignee') {
      tokens.push({ kind: 'assignee', start: t.start, end: t.end, text: t.text, username: t.payload as string });
    } else if (t.kind === 'date' && t.iso) {
      tokens.push({ kind: 'date', start: t.start, end: t.end, text: t.text, iso: t.iso });
    } else if (t.kind === 'recurrence') {
      tokens.push({
        kind: 'recurrence', start: t.start, end: t.end, text: t.text,
        repeatAfter: t.repeatAfter ?? 0,
        repeatMode: t.repeatMode ?? 0,
      });
    }
    walk = t.end;
  }
  if (walk < raw.length) {
    tokens.push({ kind: 'text', start: walk, end: raw.length, text: raw.slice(walk) });
  }

  return { title, dueDate, priority, repeatAfter, repeatMode, labelTitles, assigneeUsernames, tokens };
}

/** Convert a recurrence phrase like "every 3 days" to repeatAfter + repeatMode. */
function parseRecurrenceText(
  text: string,
): { repeatAfter: number; repeatMode: number } | null {
  const lower = text.toLowerCase().trim();

  if (lower === 'daily') return { repeatAfter: 86_400, repeatMode: 0 };
  if (lower === 'weekly') return { repeatAfter: 604_800, repeatMode: 0 };
  if (lower === 'monthly') return { repeatAfter: 0, repeatMode: 1 };
  if (lower === 'yearly') return { repeatAfter: 31_536_000, repeatMode: 0 };

  const m = lower.match(/^every\s+(\d+)?\s*(day|week|month|year)s?$/);
  if (!m) return null;

  const count = m[1] ? parseInt(m[1], 10) : 1;
  const unit = m[2]!;

  if (unit === 'month') return { repeatAfter: 0, repeatMode: 1 };

  const SECONDS: Record<string, number> = {
    day: 86_400,
    week: 604_800,
    year: 31_536_000,
  };
  const per = SECONDS[unit];
  if (!per) return null;
  return { repeatAfter: per * count, repeatMode: 0 };
}

function overlaps(start: number, end: number, ranges: RawToken[]): boolean {
  for (const r of ranges) {
    if (start < r.end && end > r.start) return true;
  }
  return false;
}
