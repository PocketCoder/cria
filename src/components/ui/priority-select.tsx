import { Flag } from 'lucide-react';
import { cn } from '@/lib/cn';

/* Vikunja priority scale (0–5) with a heat ramp: calm at the low end,
   escalating through amber/orange to red at the top. `color` drives both
   the selected-segment fill and the unselected glyph tint. Anchored on the
   theme's --color-destructive (27 hue) at level 5 for consistency. */
export interface PriorityMeta {
  value: number;
  label: string;
  color: string;
}

export const PRIORITY_META: readonly PriorityMeta[] = [
  { value: 0, label: 'None', color: 'var(--color-muted-foreground)' },
  { value: 1, label: 'Low', color: 'oklch(62% 0.12 240)' },
  { value: 2, label: 'Medium', color: 'oklch(68% 0.14 150)' },
  { value: 3, label: 'High', color: 'oklch(76% 0.15 75)' },
  { value: 4, label: 'Urgent', color: 'oklch(68% 0.19 45)' },
  { value: 5, label: 'Critical', color: 'oklch(58% 0.22 27)' },
];

export const PRIORITY_LABELS = PRIORITY_META.map((m) => m.label);

export function priorityColor(value: number): string {
  return (PRIORITY_META[value] ?? PRIORITY_META[0]!).color;
}

interface PrioritySelectProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  /** Compact omits text labels, showing only the level glyph. */
  compact?: boolean;
}

/* Segmented button group for picking a task priority. Each segment fills
   with its priority colour when selected; unselected segments tint their
   glyph and lift on hover. Behaves as an ARIA radiogroup. */
export function PrioritySelect({
  value,
  onChange,
  className,
  compact = false,
}: PrioritySelectProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Priority"
      className={cn(
        'inline-flex w-full items-stretch gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] p-0.5',
        className,
      )}
    >
      {PRIORITY_META.map((meta) => {
        const selected = value === meta.value;
        const isNone = meta.value === 0;
        return (
          <button
            key={meta.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={meta.label}
            title={meta.label}
            onClick={() => onChange(meta.value)}
            style={
              selected
                ? { backgroundColor: meta.color }
                : compact && !isNone
                  ? { color: meta.color }
                  : undefined
            }
            className={cn(
              'flex flex-1 items-center justify-center gap-1 rounded-[5px] font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]',
              compact ? 'px-1.5 py-0.5 text-footnote' : 'px-1.5 py-1 text-caption',
              selected
                ? 'text-white shadow-sm'
                : compact
                  ? 'hover:bg-[var(--color-card)]'
                  : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-card)]',
            )}
          >
            {isNone ? (
              // "None" is a muted dash when compact (just a number row), the
              // word otherwise.
              <span
                className={cn(
                  'leading-none',
                  compact && !selected && 'text-[var(--color-muted-foreground)]',
                )}
              >
                {compact ? '–' : 'None'}
              </span>
            ) : compact ? (
              // Compact non-None: number only, text coloured like its flag
              // (the colour is applied via the button's inline style above).
              <span className="leading-none tabular-nums">{meta.value}</span>
            ) : (
              <>
                <Flag
                  className="h-3 w-3 shrink-0"
                  style={selected ? undefined : { color: meta.color }}
                  fill={selected ? 'currentColor' : 'none'}
                />
                <span className="leading-none">{meta.label}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
