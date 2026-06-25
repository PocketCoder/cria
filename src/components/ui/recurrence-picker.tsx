import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { cn } from '@/lib/cn';

/**
 * Recurrence picker for the task-CREATE flow. Mirrors the task-detail
 * `InlineRepeat` editor (interval + unit + mode) but emits `{ repeatAfter,
 * repeatMode }` via `onChange` instead of writing to a task, so it can be used
 * before the task exists. Kept in step with the NL `parseRecurrence` output.
 */

const SECONDS = { HOUR: 3600, DAY: 86400, MONTH: 2_592_000 };
const UNIT_OPTIONS = ['hour', 'day', 'month'] as const;
type Unit = (typeof UNIT_OPTIONS)[number];

const REPEAT_MODE_LABELS: Record<number, string> = {
  0: 'From creation date',
  1: 'Monthly (same day)',
  2: 'From completion date',
};

function secondsToValueUnit(seconds: number): { value: number; unit: Unit } {
  if (seconds > 0 && seconds % SECONDS.MONTH === 0) return { value: seconds / SECONDS.MONTH, unit: 'month' };
  if (seconds > 0 && seconds % SECONDS.DAY === 0) return { value: seconds / SECONDS.DAY, unit: 'day' };
  return { value: seconds > 0 ? seconds / SECONDS.HOUR : 1, unit: 'hour' };
}

function valueUnitToSeconds(value: number, unit: Unit): number {
  if (unit === 'month') return value * SECONDS.MONTH;
  if (unit === 'day') return value * SECONDS.DAY;
  return value * SECONDS.HOUR;
}

function summarise(repeatAfter: number | null, repeatMode: number | null): string | null {
  if (repeatMode === 1) return 'Monthly';
  if (!repeatAfter || repeatAfter <= 0) return null;
  const { value, unit } = secondsToValueUnit(repeatAfter);
  return `Every ${value} ${unit}${value === 1 ? '' : 's'}`;
}

export function RecurrencePicker({
  repeatAfter,
  repeatMode,
  onChange,
  className,
}: {
  repeatAfter: number | null;
  repeatMode: number | null;
  onChange: (repeatAfter: number | null, repeatMode: number | null) => void;
  className?: string;
}) {
  const init = secondsToValueUnit(repeatAfter ?? 0);
  const [value, setValue] = useState(init.value);
  const [unit, setUnit] = useState<Unit>(init.unit);
  const mode = repeatMode ?? 0;
  const summary = summarise(repeatAfter, repeatMode);

  const apply = (v: number, u: Unit, m: number) => onChange(valueUnitToSeconds(v, u), m);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Repeat"
          className={cn(
            'inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]',
            className,
          )}
        >
          <RefreshCw className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
          <span className={summary ? '' : 'text-[var(--color-muted-foreground)]'}>
            {summary ?? 'Repeat'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-muted-foreground)]">Every</span>
            <input
              type="number"
              min={1}
              value={value}
              onChange={(e) => {
                const v = Math.max(1, Number(e.target.value));
                setValue(v);
                apply(v, unit, mode);
              }}
              className="w-14 rounded border border-[var(--color-border)] bg-transparent px-1.5 py-1 text-center text-xs"
            />
            <Select
              value={unit}
              onValueChange={(u) => {
                setUnit(u as Unit);
                apply(value, u as Unit, mode);
              }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_OPTIONS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                    {u === 'hour' ? 's' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Stacked, not side-by-side: the mode labels are too long to fit
              three across the popover without wrapping/overflow. */}
          <div className="flex flex-col gap-0.5">
            {([0, 1, 2] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => apply(value, unit, m)}
                className={cn(
                  'w-full rounded px-2 py-1 text-left text-xs transition-colors',
                  m === mode && summary
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
                    : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/10',
                )}
              >
                {REPEAT_MODE_LABELS[m]}
              </button>
            ))}
          </div>

          {summary ? (
            <button
              type="button"
              onClick={() => onChange(null, null)}
              className="self-start rounded px-2 py-0.5 text-footnote text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10"
            >
              Remove repeat
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
