import { useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  pickerChipClass,
  pickerRowClass,
  type PickerOpenProps,
} from '@/components/ui/popover';
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
  open,
  onOpenChange,
}: PickerOpenProps & {
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

  // Monthly mode ignores repeatAfter, so always emit 0 there.
  const apply = (v: number, u: Unit, m: number) =>
    onChange(m === 1 ? 0 : valueUnitToSeconds(v, u), m);

  const pickMode = (m: number) => {
    // Leaving monthly with the untouched 1-hour default would emit a 1-hour
    // repeat; seed 1 month instead.
    if (m !== 1 && mode === 1 && value === 1 && unit === 'hour') {
      setUnit('month');
      apply(1, 'month', m);
      return;
    }
    apply(value, unit, m);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Repeat"
          className={cn(pickerChipClass, className)}
        >
          <RefreshCw className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
          <span className={summary ? '' : 'text-[var(--color-muted-foreground)]'}>
            {summary ?? 'Repeat'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 p-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--color-muted-foreground)]">Every</span>
            <input
              aria-label="Repeat interval"
              type="number"
              min={1}
              value={value}
              onChange={(e) => {
                const v = Number.isFinite(e.target.valueAsNumber) ? Math.max(1, e.target.valueAsNumber) : 1;
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
                onClick={() => pickMode(m)}
                className={cn(pickerRowClass, m === mode && summary && 'bg-[var(--color-muted)]')}
              >
                <span className="min-w-0 flex-1 truncate">{REPEAT_MODE_LABELS[m]}</span>
                {m === mode && summary ? (
                  <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                ) : null}
              </button>
            ))}
          </div>

          {summary ? (
            <button
              type="button"
              onClick={() => onChange(null, null)}
              className={cn(pickerRowClass, 'text-[var(--color-destructive)]')}
            >
              Remove repeat
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
