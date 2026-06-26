import { useState, useEffect, useRef, useMemo } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { startOfWeek, addDays, format, isSameDay, startOfDay } from 'date-fns';
import { ChevronDown, ChevronRight, ChevronLeft, ChevronRight as ChevR } from 'lucide-react';
import { cn } from '@/lib/cn';

const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');

const WEEKS_BEFORE = 4;
const WEEKS_AFTER = 16;

/**
 * Todoist-style Upcoming header: a full-width week strip you can swipe
 * horizontally between weeks, expanding to a month grid. Tapping a day calls
 * `onPickDay` (the agenda scrolls to it). Days with tasks get a dot. Purely
 * presentational over `taskDays` (yyyy-MM-dd keys from dueDayKey).
 */
export function UpcomingCalendar({
  taskDays,
  today,
  selected,
  onPickDay,
  weekStartsOn = 1,
}: {
  taskDays: Set<string>;
  today: Date;
  selected: Date;
  onPickDay: (d: Date) => void;
  /** First day of the week, 0=Sunday … 6=Saturday (user preference). */
  weekStartsOn?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const wso = (weekStartsOn % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;

  // A run of week-start dates around today, rendered as full-width snap pages.
  const weeks = useMemo(() => {
    const base = startOfWeek(today, { weekStartsOn: wso });
    return Array.from({ length: WEEKS_BEFORE + WEEKS_AFTER + 1 }, (_, i) =>
      addDays(base, (i - WEEKS_BEFORE) * 7),
    );
  }, [today, wso]);

  // Keep the strip parked on the week that contains `selected`.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || expanded) return;
    const selStart = startOfWeek(selected, { weekStartsOn: wso }).getTime();
    const idx = weeks.findIndex((ws) => ws.getTime() === selStart);
    if (idx >= 0) el.scrollLeft = idx * el.clientWidth;
  }, [selected, expanded, weeks, wso]);

  const renderDayCell = (d: Date) => {
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
          className={cn('h-1 w-1 rounded-full', has ? 'bg-[var(--color-muted-foreground)]' : 'bg-transparent')}
          aria-hidden
        />
      </button>
    );
  };

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

      {/* Cross-fade the week strip ↔ month grid by animating each container's
          height (grid-rows 0fr↔1fr — smooth, no fixed-height guess, no dep). */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          expanded ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
        )}
      >
        <div className="overflow-hidden">
          <div
            ref={scrollerRef}
            className="flex snap-x snap-mandatory overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {weeks.map((ws) => (
              <div key={dayKey(ws)} className="flex min-w-full shrink-0 snap-start justify-between">
                {Array.from({ length: 7 }, (_, j) => renderDayCell(addDays(ws, j)))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          expanded ? 'mt-1 grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden text-[var(--color-foreground)]">
          <DayPicker
            mode="single"
            weekStartsOn={wso}
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
              root: 'rdp w-full text-sm',
              months: 'w-full',
              month: 'w-full',
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
      </div>
    </div>
  );
}
