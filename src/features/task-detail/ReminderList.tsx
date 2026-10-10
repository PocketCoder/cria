import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDateFormatter, type DateFormatters } from '@/lib/dateFormat';
import { Bell, Plus, X } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  listRemindersForTask,
  addReminder,
  removeReminder,
  type TaskReminder,
  type ReminderRelation,
} from '@/db/reminders';
import { subscribe } from '@/db/bus';
import { notificationsAllowed, openNotificationSettings } from '@/utils/notify';
import {
  formatRelativeReminder,
  periodToSeconds,
  RELATIVE_REMINDER_PRESETS,
  type PeriodUnit,
} from '@/lib/period';
import { InlineWarning } from '@/components/InlineWarning';
import { useFocusOnMount } from '@/lib/useFocusOnMount';

/**
 * Reminders for a task: list + add + remove. Edits go through the
 * task-update outbox path (reminders are a task field in Vikunja); a
 * local scheduler fires desktop notifications when they come due (see
 * useReminderScheduler).
 *
 * Two reminder shapes are supported, matching Vikunja-web:
 *   - **Relative** — `{ period: -3600, relativeTo: "due_date" }`. The
 *     server resolves the absolute trigger time from the task's due /
 *     start / end date; if that date later changes, server recomputes
 *     automatically. UI shows "1h before due", "On start date", etc.
 *   - **Absolute** — `{ at: ISO }`. One-off trigger time unrelated to
 *     any task date. UI shows the formatted date+time.
 *
 * The add UI is a small popover with preset chips (matching
 * `RELATIVE_REMINDER_PRESETS`), a "Custom…" mode for arbitrary
 * `amount + unit + relation` triples, and a "Date and time" mode for
 * the absolute form.
 */
export function ReminderList({
  taskLocalId,
  hideHeader = false,
}: {
  taskLocalId: string;
  hideHeader?: boolean;
}) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const dateFmt = useDateFormatter();

  useEffect(
    () =>
      subscribe('tasks', () => {
        void qc.invalidateQueries({ queryKey: ['reminders'] });
      }),
    [qc],
  );

  const { data: reminders = [] } = useQuery<TaskReminder[]>({
    queryKey: ['reminders', taskLocalId],
    staleTime: 30_000,
    queryFn: () => listRemindersForTask(taskLocalId),
  });

  // OS-level permission gate. macOS only fires the requestPermission
  // dialog once per app install; once dismissed/denied we can't
  // re-prompt, so the best we can do is link the user to the right
  // pane in System Settings. Refetched on focus so flipping the OS
  // toggle and coming back updates the UI without a reload.
  const { data: notifyOk = true, refetch: recheckNotify } = useQuery({
    queryKey: ['notifications-allowed'],
    queryFn: notificationsAllowed,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const handleRemove = async (r: TaskReminder) => {
    try {
      await removeReminder(taskLocalId, {
        at: r.reminderAt,
        period: r.relativePeriod,
        relativeTo: r.relativeTo as ReminderRelation | null,
      });
    } catch (err) {
      console.error('[reminders] remove failed:', err);
    }
  };

  return (
    <section className="mb-4">
      {!hideHeader ? (
        <h3 className="mb-1 flex items-center gap-1 group-label text-[var(--color-muted-foreground)]">
          <Bell className="h-3 w-3" />
          Reminders
          {reminders.length > 0 ? (
            <span className="font-normal">{reminders.length}</span>
          ) : null}
        </h3>
      ) : null}

      {reminders.length > 0 ? (
        <ul className="mb-1.5 space-y-1.5">
          {reminders.map((r) => (
            <li
              key={reminderKey(r)}
              className="group flex items-center gap-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-[13.5px] max-md:min-h-11"
            >
              <Bell className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
              <span className="flex-1">{formatReminder(r, dateFmt)}</span>
              <button
                type="button"
                onClick={() => void handleRemove(r)}
                aria-label="Remove reminder"
                className="shrink-0 rounded p-1 text-[var(--color-muted-foreground)] opacity-0 transition-opacity hover:text-[var(--color-warning-text)] group-hover:opacity-100 [@media(hover:none)]:opacity-100 max-md:p-2.5 max-md:-mr-2 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {pickerOpen && !notifyOk ? (
        <InlineWarning className="mb-1">
          Notifications are disabled for Cria — reminders you add here
          won't fire.
          <button
            type="button"
            onClick={() => {
              void openNotificationSettings();
              void recheckNotify();
            }}
            className="ml-1 underline underline-offset-2 hover:opacity-80 cursor-pointer"
          >
            Open System Settings
          </button>
        </InlineWarning>
      ) : null}

      {pickerOpen ? (
        <ReminderPicker
          taskLocalId={taskLocalId}
          onClose={() => setPickerOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-2 rounded-md px-1 py-1.5 text-[13.5px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] max-md:min-h-11 cursor-pointer"
        >
          <Plus className="h-[15px] w-[15px]" />
          Add reminder
        </button>
      )}
    </section>
  );
}

/**
 * Compose the add-reminder popover. Three modes, matching Vikunja-web's
 * ReminderDetail.vue:
 *   1. Default — list of preset chips (one click adds + closes)
 *   2. Custom — amount + unit + relation
 *   3. Absolute — datetime-local picker
 *
 * Each mode short-circuits to a successful add; cancel via X or Esc.
 */
function ReminderPicker({
  taskLocalId,
  onClose,
}: {
  taskLocalId: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'presets' | 'custom' | 'absolute'>(
    'presets',
  );
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on Escape anywhere in the picker, click outside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Capture, so its preventDefault lands before the inspector's own
    // window-level Escape handler (registered earlier) decides to close.
    window.addEventListener('keydown', onKey, true);
    // pointerdown so dismissal feels immediate
    window.addEventListener('pointerdown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onClick);
    };
  }, [onClose]);

  const addPreset = async (seconds: number, relativeTo: ReminderRelation) => {
    try {
      await addReminder(taskLocalId, { period: seconds, relativeTo });
      onClose();
    } catch (err) {
      console.error('[reminders] add failed:', err);
    }
  };

  return (
    <div
      ref={rootRef}
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1.5 text-[13.5px] shadow-sm"
    >
      {mode === 'presets' ? (
        <div className="flex flex-col gap-1">
          {RELATIVE_REMINDER_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => void addPreset(p.seconds, 'due_date')}
              className="rounded-md px-2.5 py-2 text-left hover:bg-[var(--color-muted)] max-md:min-h-11 cursor-pointer"
            >
              {p.seconds === 0 ? 'On due date' : `${p.label} due`}
            </button>
          ))}
          <div className="my-0.5 h-px bg-[var(--color-border)]" />
          <button
            type="button"
            onClick={() => setMode('custom')}
            className="rounded-md px-2.5 py-2 text-left hover:bg-[var(--color-muted)] max-md:min-h-11 cursor-pointer"
          >
            Custom…
          </button>
          <button
            type="button"
            onClick={() => setMode('absolute')}
            className="rounded-md px-2.5 py-2 text-left hover:bg-[var(--color-muted)] max-md:min-h-11 cursor-pointer"
          >
            Date and time
          </button>
        </div>
      ) : null}

      {mode === 'custom' ? (
        <CustomForm
          taskLocalId={taskLocalId}
          onCancel={() => setMode('presets')}
          onAdded={onClose}
        />
      ) : null}

      {mode === 'absolute' ? (
        <AbsoluteForm
          taskLocalId={taskLocalId}
          onCancel={() => setMode('presets')}
          onAdded={onClose}
        />
      ) : null}
    </div>
  );
}

/**
 * Arbitrary `amount + unit + before|after + relation` editor. The
 * before/after toggle is just the sign of the seconds value we send.
 */
function CustomForm({
  taskLocalId,
  onCancel,
  onAdded,
}: {
  taskLocalId: string;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const focusOnMount = useFocusOnMount<HTMLInputElement>();
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState<PeriodUnit>('hours');
  const [direction, setDirection] = useState<'before' | 'after'>('before');
  const [relativeTo, setRelativeTo] = useState<ReminderRelation>('due_date');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (amount <= 0) return;
    const signedSeconds =
      (direction === 'before' ? -1 : 1) * periodToSeconds(amount, unit);
    setBusy(true);
    try {
      await addReminder(taskLocalId, { period: signedSeconds, relativeTo });
      onAdded();
    } catch (err) {
      console.error('[reminders] add failed:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-2 p-1"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Reminder amount"
          type="number"
          min={1}
          value={amount}
          ref={focusOnMount}
          onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 0))}
          className="h-8 w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-1.5 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] max-md:h-11 max-md:text-base"
        />
        <Select value={unit} onValueChange={(v) => setUnit(v as PeriodUnit)}>
          <SelectTrigger className="h-8 w-auto text-[13.5px] max-md:h-11 max-md:text-base">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="minutes">minutes</SelectItem>
            <SelectItem value="hours">hours</SelectItem>
            <SelectItem value="days">days</SelectItem>
            <SelectItem value="weeks">weeks</SelectItem>
          </SelectContent>
        </Select>
        <Select value={direction} onValueChange={(v) => setDirection(v as 'before' | 'after')}>
          <SelectTrigger className="h-8 w-auto text-[13.5px] max-md:h-11 max-md:text-base">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="before">before</SelectItem>
            <SelectItem value="after">after</SelectItem>
          </SelectContent>
        </Select>
        <Select value={relativeTo} onValueChange={(v) => setRelativeTo(v as ReminderRelation)}>
          <SelectTrigger className="h-8 w-auto text-[13.5px] max-md:h-11 max-md:text-base">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="due_date">due date</SelectItem>
            <SelectItem value="start_date">start date</SelectItem>
            <SelectItem value="end_date">end date</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-[13.5px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] max-md:h-11 cursor-pointer"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={busy || amount <= 0}
          className="rounded-md bg-[var(--color-primary)] px-3.5 py-1.5 text-[13.5px] font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50 max-md:h-11 cursor-pointer"
        >
          Add
        </button>
      </div>
    </form>
  );
}

/** Bare-bones absolute datetime picker (the old default). */
function AbsoluteForm({
  taskLocalId,
  onCancel,
  onAdded,
}: {
  taskLocalId: string;
  onCancel: () => void;
  onAdded: () => void;
}) {
  // Seed 1h from now so the Add button isn't disabled by an empty
  // WebKit datetime-local placeholder.
  const focusOnMount = useFocusOnMount<HTMLInputElement>();
  const [draft, setDraft] = useState(() =>
    toLocalInput(new Date(Date.now() + 60 * 60 * 1000)),
  );
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!draft) return;
    const d = new Date(draft);
    if (Number.isNaN(d.getTime())) return;
    setBusy(true);
    try {
      await addReminder(taskLocalId, { at: d.toISOString() });
      onAdded();
    } catch (err) {
      console.error('[reminders] add failed:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-2 p-1"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        aria-label="Reminder date and time"
        type="datetime-local"
        value={draft}
        ref={focusOnMount}
        onChange={(e) => setDraft(e.target.value)}
        className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-2 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] max-md:h-11 max-md:text-base"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-[13.5px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] max-md:h-11 cursor-pointer"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={busy || !draft}
          className="rounded-md bg-[var(--color-primary)] px-3.5 py-1.5 text-[13.5px] font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50 max-md:h-11 cursor-pointer"
        >
          Add
        </button>
      </div>
    </form>
  );
}

/**
 * Render a reminder row label. Relative reminders use the same format
 * Vikunja-web emits ("1h before due"); absolute ones show the resolved
 * date+time. A relative reminder with no resolved trigger time yet
 * (task missing the matching date) shows the relative form plus a hint
 * suffix so the user knows it's parked.
 */
function formatReminder(r: TaskReminder, fmt: DateFormatters): string {
  if (r.relativePeriod != null && r.relativeTo) {
    const label = formatRelativeReminder(
      r.relativePeriod,
      r.relativeTo as ReminderRelation,
    );
    if (!r.reminderAt) {
      return `${label} · set the date to enable`;
    }
    return label;
  }
  if (!r.reminderAt) return '(invalid reminder)';
  try {
    return fmt.formatDateTime(r.reminderAt);
  } catch {
    return r.reminderAt;
  }
}

/** Stable React key per reminder row. Same identifying tuple the
 * `task_reminders` unique index uses. */
function reminderKey(r: TaskReminder): string {
  const at = r.reminderAt ?? '';
  const period = r.relativePeriod ?? '';
  const to = r.relativeTo ?? '';
  return `${at}|${period}|${to}`;
}

/** Format a Date as a `datetime-local` value (local time, minute
 * precision) — not toISOString(), which would be UTC. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

