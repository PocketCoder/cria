import * as chrono from 'chrono-node';
import { addDays } from 'date-fns';

const LABEL_RE = /(?:^|\s)(#"[^"]+"|#[A-Za-z0-9_-]+)(?=\s|$)/g;
const PRIORITY_RE = /(?:^|\s)(![1-5])(?=\s|$)/g;
const SOON_RE = /(?:^|\s)(soon)(?=\s|$)/gi;

export interface SearchQuery {
  /** Plain text to feed to FTS5 (everything after stripping filters). */
  text: string;
  dueDateStart: string | null;
  dueDateEnd: string | null;
  labelTitle: string | null;
  priority: number | null;
  tokens: SearchToken[];
}

export type SearchToken =
  | { kind: 'text'; text: string }
  | { kind: 'date'; text: string; start: string; end: string }
  | { kind: 'label'; text: string; title: string }
  | { kind: 'priority'; text: string; value: number };

interface RawToken {
  kind: 'label' | 'priority' | 'date';
  start: number;
  end: number;
  text: string;
  payload: string | number;
  startIso?: string;
  endIso?: string;
}

/**
 * Convert a local-timezone Date (from chrono) into a midnight-UTC ISO string
 * of the same calendar day — so it compares correctly with Vikunja's
 * midnight-UTC due_date values.
 */
function toUTCMidnight(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
}

/**
 * Convert a local-timezone Date into an end-of-day (23:59:59.999) UTC ISO
 * string of the same calendar day.
 */
function toUTCEndOfDay(d: Date): string {
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
  ).toISOString();
}

/**
 * Compute end of the week (23:59:59.999 UTC) for a local-timezone Date,
 * respecting the given `weekStartsOn` (0=Sunday, 1=Monday, …).
 */
function toUTCEndOfWeek(d: Date, weekStartsOn: number): string {
  const dayOfWeek = d.getDay();
  // diff to the last day of the week (Saturday if weekStartsOn=0, Sunday if 1)
  const diff = (6 - dayOfWeek + weekStartsOn) % 7;
  const end = new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + diff, 23, 59, 59, 999),
  );
  return end.toISOString();
}

function overlaps(start: number, end: number, ranges: RawToken[]): boolean {
  for (const r of ranges) {
    if (start < r.end && end > r.start) return true;
  }
  return false;
}

export function parseSearchQuery(input: string, now: Date = new Date()): SearchQuery {
  const raw = input;
  const claimed: RawToken[] = [];

  // --- Symbol tokens ---

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

  // --- Explicit non-chrono date tokens ---

  for (const m of raw.matchAll(SOON_RE)) {
    const matchText = m[1]!;
    const start = m.index! + (m[0]!.length - matchText.length);
    const end = start + matchText.length;
    const endDate = toUTCEndOfDay(addDays(now, 14));
    claimed.push({
      kind: 'date',
      start,
      end,
      text: matchText,
      payload: 0,
      startIso: undefined,  // null → includes overdue
      endIso: endDate,
    });
    break; // first wins
  }

  // --- Date phrases (chrono) ---

  const chronoResults = chrono.parse(raw, now, { forwardDate: true });
  for (const r of chronoResults) {
    const start = r.index;
    const end = r.index + r.text.length;
    if (overlaps(start, end, claimed)) continue;

    const sd = r.start.date();
    const rawText = r.text.toLowerCase().trim();

    // "this week" includes overdue tasks (no lower bound) up to Sunday
    const isThisWeek = rawText === 'this week' || rawText === 'this wk';
    const dateStart = isThisWeek
      ? undefined  // null → includes overdue
      : toUTCMidnight(sd);
    const dateEnd = r.end
      ? toUTCEndOfDay(r.end.date())
      : isThisWeek
        ? toUTCEndOfWeek(sd, 1)
        : toUTCEndOfDay(sd);

    claimed.push({
      kind: 'date',
      start,
      end,
      text: r.text,
      payload: 0,
      startIso: dateStart,
      endIso: dateEnd,
    });
    break; // first date wins
  }

  // --- Build plain text by stripping claimed ranges ---

  claimed.sort((a, b) => a.start - b.start);
  let text = '';
  let cursor = 0;
  for (const t of claimed) {
    if (t.start > cursor) text += raw.slice(cursor, t.start);
    cursor = t.end;
  }
  if (cursor < raw.length) text += raw.slice(cursor);
  text = text.replace(/\s+/g, ' ').trim();

  // --- Aggregate fields ---

  let dueDateStart: string | null = null;
  let dueDateEnd: string | null = null;
  let labelTitle: string | null = null;
  let priority: number | null = null;

  for (const t of claimed) {
    if (t.kind === 'date') {
      dueDateStart = t.startIso ?? null;
      dueDateEnd = t.endIso ?? null;
    } else if (t.kind === 'label') {
      labelTitle = t.payload as string;
    } else if (t.kind === 'priority') {
      priority = priority === null
        ? (t.payload as number)
        : Math.max(priority, t.payload as number);
    }
  }

  // --- Token list (interleaving text segments) ---

  const tokens: SearchToken[] = [];
  let walk = 0;
  for (const t of claimed) {
    if (t.start > walk) {
      const seg = raw.slice(walk, t.start);
      if (seg.length > 0) tokens.push({ kind: 'text', text: seg });
    }
    if (t.kind === 'date' && t.startIso && t.endIso) {
      tokens.push({ kind: 'date', text: t.text, start: t.startIso, end: t.endIso });
    } else if (t.kind === 'label') {
      tokens.push({ kind: 'label', text: t.text, title: t.payload as string });
    } else if (t.kind === 'priority') {
      tokens.push({ kind: 'priority', text: t.text, value: t.payload as number });
    }
    walk = t.end;
  }
  if (walk < raw.length) {
    tokens.push({ kind: 'text', text: raw.slice(walk) });
  }

  return { text, dueDateStart, dueDateEnd, labelTitle, priority, tokens };
}
