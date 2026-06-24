import { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar as CalendarGrid } from '@/components/ui/calendar';
import { cn } from '@/lib/cn';
import { useDateFormatter, toCalendarDate } from '@/lib/dateFormat';

interface DatePickerProps {
  value: string | null;
  onChange: (iso: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Allow an optional time-of-day. When off (default) the picker only emits
   * all-day dates (UTC midnight), matching every existing call site. When on,
   * the popover gains an "All day" toggle + time field; a timed value is
   * emitted as a local datetime ISO.
   */
  enableTime?: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Parse a stored ISO into the date + whether it carries a time-of-day.
   All-day values are stored as UTC midnight; anything else is "timed". */
function parseValue(v: string | null): {
  date?: Date;
  hasTime: boolean;
  timeStr: string;
} {
  if (!v) return { hasTime: false, timeStr: '09:00' };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { hasTime: false, timeStr: '09:00' };
  const midnightUTC =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  return {
    date: d,
    hasTime: !midnightUTC,
    timeStr: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Date',
  disabled,
  className,
  enableTime = false,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const { formatDate } = useDateFormatter();

  const parsed = parseValue(value);
  const [allDay, setAllDay] = useState(!parsed.hasTime);
  const [timeStr, setTimeStr] = useState(parsed.hasTime ? parsed.timeStr : '09:00');

  let display: string | null = null;
  let selectedDate: Date | undefined;
  if (value) {
    try {
      const cal = toCalendarDate(value);
      display = formatDate(cal);
      selectedDate = parsed.hasTime ? parsed.date ?? cal : cal;
      if (enableTime && parsed.hasTime) display = `${display} · ${parsed.timeStr}`;
    } catch {
      display = value;
    }
  }

  // Emit the ISO for a (date, all-day, time) triple. All-day → UTC midnight;
  // timed → local datetime.
  const emit = (d: Date | undefined, ad: boolean, t: string) => {
    if (!d) {
      onChange(null);
      return;
    }
    if (ad || !enableTime) {
      onChange(
        new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString(),
      );
      return;
    }
    const [hh, mm] = t.split(':').map((n) => Number(n) || 0);
    onChange(
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0).toISOString(),
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        // Seed the time controls from the current value each time we open.
        if (o) {
          const p = parseValue(value);
          setAllDay(!p.hasTime);
          setTimeStr(p.hasTime ? p.timeStr : '09:00');
        }
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)] disabled:opacity-50',
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
          <span className={cn(!display && 'text-[var(--color-muted-foreground)]')}>
            {display ?? placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8}>
        <CalendarGrid
          selected={selectedDate}
          onSelect={(d) => {
            if (!d) {
              onChange(null);
            } else {
              emit(d, allDay, timeStr);
            }
            if (!enableTime) setOpen(false);
          }}
          onClear={() => {
            onChange(null);
            setOpen(false);
          }}
        />
        {enableTime ? (
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-2">
            <label className="flex items-center gap-2 text-xs text-[var(--color-foreground)]">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => {
                  const ad = e.target.checked;
                  setAllDay(ad);
                  emit(selectedDate, ad, timeStr);
                }}
                className="h-3.5 w-3.5 accent-[var(--color-primary)]"
              />
              All day
            </label>
            <input
              type="time"
              value={timeStr}
              disabled={allDay}
              onChange={(e) => {
                const t = e.target.value || '09:00';
                setTimeStr(t);
                setAllDay(false);
                emit(selectedDate, false, t);
              }}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)] disabled:opacity-40"
            />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
