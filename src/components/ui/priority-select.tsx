import { useState } from 'react';
import { Flag } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

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
  /**
   * `segmented` (default) renders the inline 0–5 button row. `pill` renders a
   * single compact chip that opens the options in a popover — use it in tight
   * chip rows (quick-add, inline create) where the segmented row eats too much
   * horizontal space.
   */
  variant?: 'segmented' | 'pill';
}

/* Single chip + popover. The trigger shows a flag (tinted to the chosen
   priority) and its label; the popover lists the six levels. */
function PriorityPill({
  value,
  onChange,
  className,
}: Pick<PrioritySelectProps, 'value' | 'onChange' | 'className'>) {
  const [open, setOpen] = useState(false);
  const meta = PRIORITY_META[value] ?? PRIORITY_META[0]!;
  const isSet = value > 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Priority: ${meta.label}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]',
            isSet
              ? 'border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-foreground)]'
              : 'border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]',
            className,
          )}
        >
          <Flag
            className="h-3.5 w-3.5 shrink-0"
            style={isSet ? { color: meta.color } : undefined}
            fill={isSet ? 'currentColor' : 'none'}
          />
          <span>{isSet ? meta.label : 'Priority'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-40 p-1">
        <div role="radiogroup" aria-label="Priority" className="flex flex-col">
          {PRIORITY_META.map((m) => {
            const selected = m.value === value;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  onChange(m.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-muted)]',
                  selected && 'bg-[var(--color-muted)]',
                )}
              >
                <Flag
                  className="h-3.5 w-3.5 shrink-0"
                  style={m.value > 0 ? { color: m.color } : { color: 'var(--color-muted-foreground)' }}
                  fill={m.value > 0 ? 'currentColor' : 'none'}
                />
                <span className="flex-1">{m.label}</span>
                {selected ? (
                  <span className="text-[var(--color-primary)]">✓</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* Segmented button group for picking a task priority. Each segment fills
   with its priority colour when selected; unselected segments tint their
   glyph and lift on hover. Behaves as an ARIA radiogroup. */
export function PrioritySelect({
  value,
  onChange,
  className,
  compact = false,
  variant = 'segmented',
}: PrioritySelectProps) {
  if (variant === 'pill') {
    return <PriorityPill value={value} onChange={onChange} className={className} />;
  }
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
              'flex items-center justify-center gap-1 rounded-[5px] font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]',
              compact ? 'px-1.5 py-0.5 text-footnote' : 'px-1 py-1 text-caption',
              compact || !selected ? 'min-w-0 flex-1' : 'shrink-0',
              selected
                ? 'text-white shadow-sm'
                : compact
                  ? 'hover:bg-[var(--color-card)]'
                  : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-card)]',
            )}
          >
            {isNone ? (

              <span
                className={cn(
                  'leading-none',
                  !selected && 'text-[var(--color-muted-foreground)]',
                )}
              >
                {selected ? 'None' : '–'}
              </span>
            ) : compact ? (

              <span className="leading-none tabular-nums">{meta.value}</span>
            ) : (

              <>
                <Flag
                  className="h-3 w-3 shrink-0"
                  style={selected ? undefined : { color: meta.color }}
                  fill={selected ? 'currentColor' : 'none'}
                />
                {selected && <span className="whitespace-nowrap leading-none">{meta.label}</span>}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
