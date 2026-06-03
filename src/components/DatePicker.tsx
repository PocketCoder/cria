import { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar as CalendarGrid } from '@/components/ui/calendar';
import { useDateFormatter } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';

interface DatePickerProps {
  /** Selected value as an ISO string (or a `YYYY-MM-DD` date), or null. */
  value: string | null;
  /** Emits a midnight-UTC ISO string, or null when cleared. */
  onChange: (iso: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A date picker whose label renders through the user's date-format
 * preference — unlike a native `<input type="date">`, which always shows the
 * OS locale and ignores the app setting. Built on the same calendar grid as
 * the task-detail editor.
 *
 * Due dates are stored at midnight UTC (Vikunja's date-field convention). We
 * read them back by their UTC calendar components so the displayed day never
 * shifts by timezone — a date is a calendar day, not an instant. Time-of-day
 * is out of scope here (tracked in #74).
 */
function toCalendarDate(value: string): Date {
  const d = new Date(value);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Date',
  disabled,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const { formatDate } = useDateFormatter();

  let display: string | null = null;
  let selectedDate: Date | undefined;
  if (value) {
    try {
      const cal = toCalendarDate(value);
      display = formatDate(cal);
      selectedDate = cal;
    } catch {
      display = value;
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)] disabled:opacity-50',
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
              onChange(
                new Date(
                  Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()),
                ).toISOString(),
              );
            }
            setOpen(false);
          }}
          onClear={() => {
            onChange(null);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
