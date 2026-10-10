import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, nextMonday, startOfDay } from 'date-fns';
import { cn } from '@/lib/cn';

interface CalendarProps {
  selected?: Date | undefined;
  onSelect?: (date: Date | undefined) => void;
  /** Optional "Clear" button rendered beneath the grid. */
  onClear?: () => void;
  /** Minimum selectable date (exclusive of earlier). */
  fromDate?: Date;
  /** Today / Tomorrow / Next week quick picks above the grid (default on). */
  shortcuts?: boolean;
}

/**
 * Themed wrapper around react-day-picker. Sized to fit comfortably inside
 * a popover anchored against the TaskActions sidebar (~280px wide
 * sidebar, so the calendar caps around 240–260px).
 *
 * react-day-picker brings its own stylesheet (`style.css`) which gives us
 * the grid layout for free; we re-skin tokens via the `classNames` map so
 * the picker matches the rest of the UI in both light and dark themes.
 */
export function Calendar({
  selected,
  onSelect,
  onClear,
  fromDate,
  shortcuts = true,
}: CalendarProps) {
  const today = startOfDay(new Date());
  const quick = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'Next week', date: nextMonday(today) },
  ];
  return (
    <div className="text-[var(--color-foreground)]">
      {shortcuts && onSelect ? (
        <div className="mb-1 flex gap-1.5 px-1 pt-1">
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => onSelect(q.date)}
              className="flex-1 rounded-full border border-[var(--color-border)] px-2 py-1.5 text-[12.5px] transition-colors hover:bg-[var(--color-muted)] max-md:min-h-11 cursor-pointer"
            >
              {q.label}
            </button>
          ))}
        </div>
      ) : null}
      <DayPicker
        mode="single"
        selected={selected}
        onSelect={onSelect}
        startMonth={fromDate}
        showOutsideDays
        components={{
          PreviousMonthButton: (props) => (
            <button
              {...props}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--color-muted)]',
                props.className,
              )}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ),
          NextMonthButton: (props) => (
            <button
              {...props}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--color-muted)]',
                props.className,
              )}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          ),
        }}
        classNames={{
          root: 'rdp w-[252px] max-w-full p-1 text-[13px]',
          month_caption: 'flex items-center justify-start pb-1 pl-1.5 text-sm font-semibold',
          caption_label: 'px-1',
          nav: 'absolute right-0 top-0 flex gap-0.5',
          month_grid: 'mt-2 w-full border-collapse',
          weekdays: 'flex',
          weekday: 'w-[34px] text-caption text-[var(--color-muted-foreground)]',
          week: 'flex w-full mt-0.5',
          day: 'h-[34px] w-[34px] p-0 text-center text-[13px]',
          day_button:
            'inline-flex h-[34px] w-[34px] items-center justify-center rounded-full hover:bg-[var(--color-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]',
          today: '[&_button]:font-semibold [&_button]:text-[var(--color-primary)]',
          selected:
            '[&_button]:bg-[var(--color-primary)] [&_button]:text-[var(--color-primary-foreground)] [&_button:hover]:bg-[var(--color-primary)] [&_button:hover]:opacity-90',
          outside: 'opacity-50 text-[var(--color-muted-foreground)]',
          disabled: 'opacity-30 pointer-events-none',
        }}
      />
      {onClear && selected ? (
        <div className="mt-1.5 flex justify-end border-t border-[var(--color-border)] pt-1">
          <button
            type="button"
            onClick={onClear}
            className="text-caption text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:underline"
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
