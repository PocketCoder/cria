/**
 * Position-tracking lexer for the Vikunja filter DSL, used by FilterInput to
 * paint syntax highlighting and drive autocomplete. Deliberately separate
 * from filterQueryParser's tokenizer (which has no positions and throws on
 * partial input) — this one never throws: anything unrecognised is 'unknown'.
 */

export type SpanKind =
  | 'field'
  | 'operator'
  | 'value'
  | 'logical'
  | 'paren'
  | 'unknown';

export interface HighlightSpan {
  start: number;
  end: number;
  kind: SpanKind;
}

export const FILTER_FIELDS = [
  'done',
  'priority',
  'percentDone',
  'dueDate',
  'startDate',
  'endDate',
  'doneAt',
  'created',
  'updated',
  'labels',
  'assignees',
  'project',
  'reminders',
] as const;

const FIELD_SET = new Set<string>(FILTER_FIELDS);
const DATE_MATH = /^now([+-]\d+[dwMy].*)?$/;
const WORD_OPS = new Set(['in', 'like', 'not']);

export function highlightSpans(query: string): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  let i = 0;
  // Track whether the previous meaningful token puts us in "field position"
  // (start, after && / || / open paren) so identifiers classify correctly.
  let fieldPosition = true;

  const push = (start: number, end: number, kind: SpanKind) => {
    spans.push({ start, end, kind });
  };

  while (i < query.length) {
    const c = query[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      push(i, i + 1, 'paren');
      if (c === '(') fieldPosition = true;
      i++;
      continue;
    }
    if (query.startsWith('&&', i) || query.startsWith('||', i)) {
      push(i, i + 2, 'logical');
      fieldPosition = true;
      i += 2;
      continue;
    }
    if (['>=', '<=', '!='].some((op) => query.startsWith(op, i))) {
      push(i, i + 2, 'operator');
      fieldPosition = false;
      i += 2;
      continue;
    }
    if (c === '=' || c === '>' || c === '<') {
      push(i, i + 1, 'operator');
      fieldPosition = false;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      // String literal — tolerate an unterminated one at end of input.
      let j = i + 1;
      while (j < query.length && query[j] !== c) j++;
      push(i, Math.min(j + 1, query.length), 'value');
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < query.length && /[0-9.]/.test(query[j]!)) j++;
      push(i, j, 'value');
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < query.length && /[A-Za-z0-9_/+-]/.test(query[j]!)) j++;
      const word = query.slice(i, j);
      const lower = word.toLowerCase();
      if (WORD_OPS.has(lower)) {
        push(i, j, 'operator');
        fieldPosition = false;
      } else if (fieldPosition) {
        push(i, j, FIELD_SET.has(word) ? 'field' : 'unknown');
        fieldPosition = false;
      } else if (
        lower === 'true' ||
        lower === 'false' ||
        DATE_MATH.test(word)
      ) {
        push(i, j, 'value');
      } else {
        // Bare identifier in value position (label/assignee/project name).
        push(i, j, 'value');
      }
      i = j;
      continue;
    }
    push(i, i + 1, 'unknown');
    i++;
  }
  return spans;
}

export type AutocompleteKind = 'field' | 'label' | 'project' | 'assignee';

export interface AutocompleteContext {
  kind: AutocompleteKind;
  /** The partial word being typed (without any opening quote). */
  prefix: string;
  /** Index in the query where the replacement should start. */
  replaceStart: number;
}

const ENTITY_FIELDS: Record<string, AutocompleteKind> = {
  labels: 'label',
  project: 'project',
  assignees: 'assignee',
};

/**
 * What to suggest at `cursor`. Field names at the start / after logical
 * joins; label/project/assignee values after those fields' operators; null
 * anywhere else (numbers, dates, booleans need no lookup).
 */
export function autocompleteContext(
  query: string,
  cursor: number,
): AutocompleteContext | null {
  const before = query.slice(0, cursor);

  // Current partial word (possibly quoted).
  const wordMatch = /(['"]?)([A-Za-z0-9_ ]*)$/.exec(before);
  const quote = wordMatch?.[1] ?? '';
  let prefix = wordMatch?.[2] ?? '';
  // A prefix with a space only makes sense inside quotes (multi-word titles).
  if (!quote && prefix.includes(' ')) {
    prefix = /([A-Za-z0-9_]*)$/.exec(before)?.[1] ?? '';
  }
  const replaceStart = cursor - prefix.length - (quote ? 1 : 0);
  const context = before.slice(0, replaceStart);

  // Field position: nothing before, or the last meaningful token is a
  // logical join or open paren.
  if (/^\s*$/.test(context) || /(\|\||&&|\()\s*$/.test(context)) {
    return { kind: 'field', prefix, replaceStart };
  }

  // Value position for entity fields: field followed by an operator (and,
  // for in-lists, optionally previous values + comma).
  const valueMatch =
    /([A-Za-z_]+)\s*(=|!=|like|in|not\s+in)\s*(?:[^&|()]*,)?\s*$/i.exec(context);
  if (valueMatch) {
    const kind = ENTITY_FIELDS[valueMatch[1]!];
    if (kind) return { kind, prefix, replaceStart };
  }

  return null;
}
