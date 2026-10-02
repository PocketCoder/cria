import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  pickerChipClass,
  pickerRowClass,
  type PickerOpenProps,
} from '@/components/ui/popover';
import { RELATIVE_REMINDER_PRESETS, formatRelativeReminder } from '@/lib/period';
import type { AddReminderInput, ReminderRelation } from '@/db/reminders';

const pad = (n: number) => String(n).padStart(2, '0');
function localDatetimeValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function describe(r: AddReminderInput): string {
  if (r.period != null && r.relativeTo) {
    return formatRelativeReminder(r.period, r.relativeTo);
  }
  if (r.at) {
    try {
      return new Date(r.at).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return r.at;
    }
  }
  return 'reminder';
}

/**
 * Compact reminder chip for the create flow. Collects a list of reminder specs
 * (relative-to-due presets or an absolute date+time) that the caller persists
 * with `addReminder` after the task is created. Mirrors the detail-view picker
 * but stays inline as a pill.
 */
export function ReminderPill({
  value,
  onChange,
  className,
  ...ctl
}: PickerOpenProps & {
  value: AddReminderInput[];
  onChange: (next: AddReminderInput[]) => void;
  className?: string;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = ctl.open ?? innerOpen;
  const setOpen = ctl.onOpenChange ?? setInnerOpen;
  const [absDraft, setAbsDraft] = useState(() =>
    localDatetimeValue(new Date(Date.now() + 60 * 60 * 1000)),
  );
  const count = value.length;

  const addPreset = (seconds: number) => {
    const next: AddReminderInput = {
      period: seconds,
      relativeTo: 'due_date' as ReminderRelation,
    };
    if (value.some((r) => r.period === seconds && r.relativeTo === 'due_date')) return;
    onChange([...value, next]);
  };
  const addAbsolute = () => {
    const d = new Date(absDraft);
    if (Number.isNaN(d.getTime())) return;
    onChange([...value, { at: d.toISOString() }]);
  };
  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Reminders"
          className={cn(
            pickerChipClass,
            count === 0 && 'text-[var(--color-muted-foreground)]',
            className,
          )}
        >
          <Bell className="h-3.5 w-3.5 shrink-0" />
          <span>{count > 0 ? `${count} reminder${count === 1 ? '' : 's'}` : 'Reminder'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 p-1 text-[13.5px]">
        {value.length > 0 ? (
          <ul className="mb-2 space-y-1">
            {value.map((r, i) => (
              <li
                key={`${r.at ?? ''}|${r.period ?? ''}|${r.relativeTo ?? ''}`}
                className="group flex items-center gap-2 rounded-md bg-[var(--color-muted)] px-2 py-1.5"
              >
                <Bell className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]" />
                <span className="flex-1 truncate">{describe(r)}</span>
                <button
                  type="button"
                  aria-label="Remove reminder"
                  onClick={() => removeAt(i)}
                  className="shrink-0 rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-warning)]"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-[var(--color-muted-foreground)]">
          Relative to due date
        </p>
        <div className="mb-2 flex flex-col">
          {RELATIVE_REMINDER_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => addPreset(p.seconds)}
              className={pickerRowClass}
            >
              {p.seconds === 0 ? 'On due date' : `${p.label} before due`}
            </button>
          ))}
        </div>

        <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-[var(--color-muted-foreground)]">
          At a date &amp; time
        </p>
        <div className="flex items-center gap-1.5 px-1 pb-1">
          <input
            aria-label="Reminder date and time"
            type="datetime-local"
            value={absDraft}
            onChange={(e) => setAbsDraft(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
          />
          <button
            type="button"
            onClick={addAbsolute}
            className="shrink-0 rounded-md bg-[var(--color-primary)] px-2 py-1 font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
          >
            Add
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
