import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import {
  startOfWeek,
  addDays,
  format,
  isSameDay,
  startOfDay,
} from 'date-fns';
import { ChevronDown, ChevronRight, ChevronLeft, ChevronRight as ChevR } from 'lucide-react';
import { cn } from '@/lib/cn';

const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');

/**
 * Todoist-style Upcoming header: a week strip that expands to a month grid.
 * Tapping a day calls `onPickDay` (the agenda scrolls to it). Days that have
 * tasks get a dot. Purely presentational over `taskDays` (yyyy-MM-dd set).
 */
export function UpcomingCalendar({
  taskDays,
  today,
  selected,
  onPickDay,
}: {
  taskDays: Set<string>;
  today: Date;
  selected: Date;
  onPickDay: (d: Date) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const weekStart = startOfWeek(selected, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-background)] px-4 pb-2 pt-1">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={cn(
          'flex items-center gap-1 py-1 text-base font-semibold',
          expanded ? 'text-[var(--color-primary)]' : 'text-[var(--color-foreground)]',
        )}
      >
        {format(selected, 'MMM yyyy')}
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {expanded ? (
        <div className="text-[var(--color-foreground)]">
          <DayPicker
            mode="single"
            weekStartsOn={1}
            selected={selected}
            onSelect={(d) => {
              if (!d) return;
              onPickDay(startOfDay(d));
              setExpanded(false);
            }}
            showOutsideDays
            modifiers={{ hasTasks: (d) => taskDays.has(dayKey(d)) }}
            modifiersClassNames={{ hasTasks: 'day-has-tasks' }}
            components={{
              PreviousMonthButton: (props) => (
                <button {...props} className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--color-muted)]', props.className)} aria-label="Previous month">
                  <ChevronLeft className="h-4 w-4" />
                </button>
              ),
              NextMonthButton: (props) => (
                <button {...props} className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--color-muted)]', props.className)} aria-label="Next month">
                  <ChevR className="h-4 w-4" />
                </button>
              ),
            }}
            classNames={{
              root: 'rdp text-sm',
              month_caption: 'sr-only',
              nav: 'absolute right-0 -top-7 flex gap-0.5',
              month_grid: 'w-full border-collapse',
              weekdays: 'flex justify-between',
              weekday: 'flex-1 text-footnote font-medium text-[var(--color-muted-foreground)] uppercase',
              week: 'flex w-full justify-between mt-1',
              day: 'relative h-9 flex-1 text-center text-sm',
              day_button: 'mx-auto inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--color-muted)] focus:outline-none',
              today: '[&_button]:font-semibold [&_button]:text-[var(--color-primary)]',
              selected: '[&_button]:bg-[var(--color-primary)] [&_button]:text-white [&_button:hover]:bg-[var(--color-primary)]',
              outside: 'opacity-40',
            }}
          />
        </div>
      ) : (
        <div className="flex justify-between">
          {weekDays.map((d) => {
            const isToday = isSameDay(d, today);
            const isSel = isSameDay(d, selected);
            const has = taskDays.has(dayKey(d));
            return (
              <button
                key={dayKey(d)}
                type="button"
                onClick={() => onPickDay(d)}
                className="flex flex-1 flex-col items-center gap-1 py-1"
              >
                <span className="text-footnote font-medium uppercase text-[var(--color-muted-foreground)]">
                  {format(d, 'EEEEE')}
                </span>
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm',
                    isToday && 'bg-[var(--color-primary)] font-semibold text-white',
                    !isToday && isSel && 'ring-1 ring-[var(--color-primary)] text-[var(--color-primary)]',
                    !isToday && !isSel && 'text-[var(--color-foreground)]',
                  )}
                >
                  {format(d, 'd')}
                </span>
                <span
                  className={cn(
                    'h-1 w-1 rounded-full',
                    has && !isToday ? 'bg-[var(--color-muted-foreground)]' : 'bg-transparent',
                  )}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
