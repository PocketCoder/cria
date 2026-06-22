/**
 * Turn raw OCR output (one string per recognised text line, in reading order)
 * into a clean list of shopping-list items — one per task to be created.
 *
 * The heuristics here are deliberately conservative: OCR on a real shopping
 * list produces leading bullets/checkboxes, quantity prefixes, stray
 * punctuation, and the occasional title line ("Shopping List"). We strip the
 * decoration, drop obvious non-items, split lines that clearly hold several
 * comma-separated items, and de-duplicate — without trying to be clever about
 * what is or isn't a grocery.
 *
 * Pure and synchronous so it can be unit-tested without any OCR engine.
 */

/** Bullets, checkboxes and list glyphs that lead a list item. */
const LEADING_MARKER_RE =
  /^\s*(?:[-–—*•·▪◦‣⁃o☐☑✓✔x×]\s+|\[[ xX]?\]\s*|\d{1,3}[.)]\s+)/;

/** A line that is just a heading / not an item. */
const HEADING_RE =
  /^(?:shopping(?:\s+list)?|grocery(?:\s+list)?|groceries|to\s*buy|list|todo|to\s*do)\s*:?\s*$/i;

/** Collapse internal whitespace and trim. */
function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Strip a single leading list marker (bullet, checkbox, "1.", etc.). */
function stripLeadingMarker(s: string): string {
  return s.replace(LEADING_MARKER_RE, '');
}

/** Trim trailing list punctuation and stray separators. */
function stripEdgePunctuation(s: string): string {
  return s.replace(/^[\s,;.]+/, '').replace(/[\s,;]+$/, '').trim();
}

/**
 * Split a line into items when it clearly enumerates several — e.g.
 * "milk, eggs, bread" — but never on commas inside a quantity like
 * "1,5 kg flour". We split on commas (and " and ") only when the line has no
 * digits adjacent to the comma, to avoid breaking decimal/grouped numbers.
 */
function splitInlineItems(line: string): string[] {
  // Don't split short lines or lines that read as a single phrase.
  if (!/[,]|(?:\band\b)/i.test(line)) return [line];
  const parts = line
    .split(/\s*,\s*|\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  // Reject the split if any fragment is implausibly tiny (likely a decimal
  // like "1,5" or an abbreviation) — keep the original line intact instead.
  if (parts.length < 2 || parts.some((p) => p.replace(/[^a-z]/gi, '').length < 2)) {
    return [line];
  }
  return parts;
}

export interface ParseOptions {
  /** Also split comma/"and"-separated lines into separate items. Default true. */
  splitInline?: boolean;
  /** Drop items shorter than this many letters. Default 1. */
  minLetters?: number;
}

/**
 * Parse OCR lines into de-duplicated, cleaned item strings.
 * Order is preserved (first occurrence wins for duplicates).
 */
export function parseShoppingItems(
  lines: readonly string[],
  opts: ParseOptions = {},
): string[] {
  const { splitInline = true, minLetters = 1 } = opts;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of lines) {
    for (const segment of raw.split(/\r?\n/)) {
      let line = normaliseWhitespace(segment);
      if (!line) continue;
      line = stripEdgePunctuation(stripLeadingMarker(line));
      if (!line || HEADING_RE.test(line)) continue;

      const candidates = splitInline ? splitInlineItems(line) : [line];
      for (const candidate of candidates) {
        const item = stripEdgePunctuation(candidate);
        const letters = item.replace(/[^a-z]/gi, '').length;
        if (letters < minLetters) continue;
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
    }
  }

  return out;
}
