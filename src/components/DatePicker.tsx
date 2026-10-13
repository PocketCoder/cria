import { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  pickerChipClass,
  type PickerOpenProps,
} from '@/components/ui/popover';
import { Calendar as CalendarGrid } from '@/components/ui/calendar';
import { cn } from '@/lib/cn';
import { useDateFormatter } from '@/lib/dateFormat';
import { describePickerValue, parseValue, toPickerIso } from '@/lib/datePickerValue';

interface DatePickerProps extends PickerOpenProps {
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
  /**
   * Todoist-style chip: when a date is set, show a relative label
   * (Today / Tomorrow / weekday / date) and tint the chip — green for today,
   * red for overdue, accent for future. Off by default so other call sites
   * keep their plain formatted date. Also switches the trigger to the
   * quick-add chip style.
   */
  smart?: boolean;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Date',
  disabled,
  className,
  enableTime = false,
  smart = false,
  ...ctl
}: DatePickerProps) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = ctl.open ?? innerOpen;
  const setOpen = ctl.onOpenChange ?? setInnerOpen;
  const { formatDate } = useDateFormatter();

  const parsed = parseValue(value);
  const [allDay, setAllDay] = useState(!parsed.hasTime);
  const [timeStr, setTimeStr] = useState(parsed.hasTime ? parsed.timeStr : '09:00');

  const { display, selectedDate, chipColor } = describePickerValue(value, {
    enableTime,
    smart,
    formatDate,
  });

  // Emit the ISO for a (date, all-day, time) triple. All-day → UTC midnight;
  // timed → local datetime.
  const emit = (d: Date | undefined, ad: boolean, t: string) => {
    onChange(toPickerIso(d, ad, t, enableTime));
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
          style={chipColor ? { color: chipColor, borderColor: chipColor } : undefined}
          className={cn(
            smart
              ? pickerChipClass
              : 'inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]',
            'disabled:opacity-50',
            className,
          )}
        >
          <CalendarIcon
            className="h-3.5 w-3.5"
            style={{ color: chipColor ?? 'var(--color-muted-foreground)' }}
          />
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
          <TimeControls
            allDay={allDay}
            timeStr={timeStr}
            onAllDayChange={(ad) => {
              setAllDay(ad);
              emit(selectedDate, ad, timeStr);
            }}
            onTimeChange={(t) => {
              setTimeStr(t);
              setAllDay(false);
              emit(selectedDate, false, t);
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function TimeControls({
  allDay,
  timeStr,
  onAllDayChange,
  onTimeChange,
}: {
  allDay: boolean;
  timeStr: string;
  onAllDayChange: (allDay: boolean) => void;
  onTimeChange: (time: string) => void;
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-2">
      <label className="flex items-center gap-2 text-xs text-[var(--color-foreground)]">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => onAllDayChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--color-primary)]"
        />
        All day
      </label>
      <input
        aria-label="Time"
        type="time"
        value={timeStr}
        disabled={allDay}
        onChange={(e) => onTimeChange(e.target.value || '09:00')}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)] disabled:opacity-40"
      />
    </div>
  );
}
