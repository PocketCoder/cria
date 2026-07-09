import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useLabels } from '@/queries/labels';
import { useProjects } from '@/queries/projects';
import {
  highlightSpans,
  autocompleteContext,
  FILTER_FIELDS,
  type SpanKind,
} from '@/lib/filterHighlight';

const KIND_COLOR: Record<SpanKind, string> = {
  field: 'var(--color-primary)',
  operator: 'var(--color-muted-foreground)',
  value: 'var(--color-success, #15803d)',
  logical: 'var(--color-warning, #b45309)',
  paren: 'var(--color-muted-foreground)',
  unknown: 'var(--color-destructive)',
};

/** Needs to match the textarea EXACTLY so overlay text sits under the caret. */
const SHARED_TEXT_STYLE: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '12px',
  lineHeight: '18px',
  padding: '6px 10px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

/**
 * Vikunja-style filter query input: syntax highlighting (colored overlay
 * behind a transparent textarea) + autocomplete for fields, labels and
 * projects — mirroring upstream's FilterInput.vue behavior.
 */
export function FilterInput({
  value,
  onChange,
  rows = 2,
  autoFocus,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const { data: labels = [] } = useLabels();
  const { data: projects = [] } = useProjects();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);

  const spans = useMemo(() => highlightSpans(value), [value]);

  const ctx = useMemo(
    () => (dismissed ? null : autocompleteContext(value, cursor)),
    [value, cursor, dismissed],
  );

  const suggestions = useMemo(() => {
    if (!ctx) return [];
    const prefix = ctx.prefix.toLowerCase();
    let candidates: string[] = [];
    if (ctx.kind === 'field') {
      candidates = [...FILTER_FIELDS];
    } else if (ctx.kind === 'label') {
      candidates = labels.map((l) => l.title);
    } else if (ctx.kind === 'project') {
      candidates = projects
        .filter((p) => p.serverId == null || p.serverId > 0)
        .map((p) => p.title);
    }
    // assignee suggestions need project members — out of scope until D1 data
    return candidates
      .filter((c) => c.toLowerCase().startsWith(prefix) && c.toLowerCase() !== prefix)
      .slice(0, 8);
  }, [ctx, labels, projects]);

  const accept = (suggestion: string) => {
    if (!ctx) return;
    const needsQuotes = ctx.kind !== 'field' && /[^A-Za-z0-9_]/.test(suggestion);
    const insert = needsQuotes ? `'${suggestion}'` : suggestion;
    const next =
      value.slice(0, ctx.replaceStart) + insert + value.slice(cursor);
    onChange(next);
    const newPos = ctx.replaceStart + insert.length;
    requestAnimationFrame(() => {
      taRef.current?.setSelectionRange(newPos, newPos);
      setCursor(newPos);
    });
  };

  const syncCursor = () => {
    setCursor(taRef.current?.selectionStart ?? 0);
    setDismissed(false);
    setHighlightIdx(0);
  };

  // Build overlay segments: colored spans + plain gaps.
  const overlay = useMemo(() => {
    const parts: Array<{ text: string; color?: string }> = [];
    let pos = 0;
    for (const s of spans) {
      if (s.start > pos) parts.push({ text: value.slice(pos, s.start) });
      parts.push({ text: value.slice(s.start, s.end), color: KIND_COLOR[s.kind] });
      pos = s.end;
    }
    if (pos < value.length) parts.push({ text: value.slice(pos) });
    return parts;
  }, [spans, value]);

  return (
    <div className="relative">
      <div
        ref={overlayRef}
        aria-hidden="true"
        style={SHARED_TEXT_STYLE}
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent"
      >
        {overlay.map((p, i) => (
          <span key={i} style={p.color ? { color: p.color } : undefined}>
            {p.text}
          </span>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          ...SHARED_TEXT_STYLE,
          color: 'transparent',
          caretColor: 'var(--color-foreground)',
        }}
        className="relative w-full resize-none rounded-md border border-[var(--color-border)] bg-transparent outline-none focus:border-[var(--color-primary)]"
        onChange={(e) => {
          onChange(e.target.value);
          setDismissed(false);
        }}
        onKeyUp={syncCursor}
        onClick={syncCursor}
        onScroll={() => {
          if (overlayRef.current && taRef.current) {
            overlayRef.current.scrollTop = taRef.current.scrollTop;
          }
        }}
        onKeyDown={(e) => {
          if (!suggestions.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightIdx((i) => (i + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            accept(suggestions[highlightIdx] ?? suggestions[0]!);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setDismissed(true);
          }
        }}
      />
      {suggestions.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 max-h-48 w-56 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)] py-1 shadow-md">
          {suggestions.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                className={
                  'w-full px-2.5 py-1 text-left font-mono text-xs hover:bg-[var(--color-muted)]' +
                  (i === highlightIdx ? ' bg-[var(--color-muted)]' : '')
                }
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
