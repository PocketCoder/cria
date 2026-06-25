import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

interface CalendarProps {
  selected?: Date | undefined;
  onSelect?: (date: Date | undefined) => void;
  /** Optional "Clear" button rendered beneath the grid. */
  onClear?: () => void;
  /** Minimum selectable date (exclusive of earlier). */
  fromDate?: Date;
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
}: CalendarProps) {
  return (
    <div className="text-[var(--color-foreground)]">
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
          root: 'rdp p-1 text-xs',
          month_caption: 'flex items-center justify-center pb-1 text-xs font-medium',
          caption_label: 'px-1',
          nav: 'absolute right-0 top-0 flex gap-0.5',
          month_grid: 'mt-2 w-full border-collapse',
          weekdays: 'flex',
          weekday: 'w-7 text-footnote font-medium text-[var(--color-muted-foreground)] uppercase',
          week: 'flex w-full mt-0.5',
          day: 'h-7 w-7 p-0 text-center text-xs',
          day_button:
            'inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]',
          today: '[&_button]:font-semibold [&_button]:text-[var(--color-primary)]',
          selected:
            '[&_button]:bg-[var(--color-primary)] [&_button]:text-[var(--color-primary-foreground)] [&_button:hover]:bg-[var(--color-primary)] [&_button:hover]:opacity-90',
          outside: 'opacity-40',
          disabled: 'opacity-30 pointer-events-none',
        }}
      />
      {onClear && selected ? (
        <div className="flex justify-end border-t border-[var(--color-border)] pt-1">
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
