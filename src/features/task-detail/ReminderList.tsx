import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDateFormatter, type DateFormatters } from '@/lib/dateFormat';
import { AlertTriangle, Bell, ChevronDown, Plus, X } from 'lucide-react';
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
export function ReminderList({ taskLocalId }: { taskLocalId: string }) {
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
      <h3 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        <Bell className="h-3 w-3" />
        Reminders
        {reminders.length > 0 ? (
          <span className="font-normal">{reminders.length}</span>
        ) : null}
      </h3>

      {reminders.length > 0 ? (
        <ul className="mb-1 space-y-1">
          {reminders.map((r) => (
            <li
              key={reminderKey(r)}
              className="group flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-xs"
            >
              <Bell className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
              <span className="flex-1">{formatReminder(r, dateFmt)}</span>
              <button
                type="button"
                onClick={() => void handleRemove(r)}
                aria-label="Remove reminder"
                className="shrink-0 rounded p-0.5 text-[var(--color-muted-foreground)] opacity-0 transition-opacity hover:text-[var(--color-warning)] group-hover:opacity-100 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {pickerOpen && !notifyOk ? (
        <div className="mb-1 flex items-start gap-2 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-2 py-1.5 text-xs text-[var(--color-warning)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1 leading-snug text-[var(--color-foreground)]">
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
          </div>
        </div>
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
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
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
    window.addEventListener('keydown', onKey);
    // pointerdown so dismissal feels immediate
    window.addEventListener('pointerdown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
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
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 text-xs shadow-sm"
    >
      {mode === 'presets' ? (
        <div className="flex flex-col gap-1">
          {RELATIVE_REMINDER_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => void addPreset(p.seconds, 'due_date')}
              className="rounded px-2 py-1 text-left hover:bg-[var(--color-muted)] cursor-pointer"
            >
              {p.seconds === 0 ? 'On due date' : `${p.label} due`}
            </button>
          ))}
          <div className="my-0.5 h-px bg-[var(--color-border)]" />
          <button
            type="button"
            onClick={() => setMode('custom')}
            className="rounded px-2 py-1 text-left hover:bg-[var(--color-muted)] cursor-pointer"
          >
            Custom…
          </button>
          <button
            type="button"
            onClick={() => setMode('absolute')}
            className="rounded px-2 py-1 text-left hover:bg-[var(--color-muted)] cursor-pointer"
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
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="number"
          min={1}
          value={amount}
          autoFocus
          onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 0))}
          className="w-14 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
        />
        <Select
          value={unit}
          onChange={(v) => setUnit(v as PeriodUnit)}
          options={[
            ['minutes', 'minutes'],
            ['hours', 'hours'],
            ['days', 'days'],
            ['weeks', 'weeks'],
          ]}
        />
        <Select
          value={direction}
          onChange={(v) => setDirection(v as 'before' | 'after')}
          options={[
            ['before', 'before'],
            ['after', 'after'],
          ]}
        />
        <Select
          value={relativeTo}
          onChange={(v) => setRelativeTo(v as ReminderRelation)}
          options={[
            ['due_date', 'due date'],
            ['start_date', 'start date'],
            ['end_date', 'end date'],
          ]}
        />
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] cursor-pointer"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={busy || amount <= 0}
          className="rounded-md bg-[var(--color-primary)] px-2 py-1 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50 cursor-pointer"
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
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        type="datetime-local"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] cursor-pointer"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={busy || !draft}
          className="rounded-md bg-[var(--color-primary)] px-2 py-1 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50 cursor-pointer"
        >
          Add
        </button>
      </div>
    </form>
  );
}

/** Tiny styled <select>. Inline because we use it in three places in
 * this file only. */
function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly (readonly [T, string])[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="appearance-none rounded border border-[var(--color-border)] bg-[var(--color-input)] py-1 pl-1.5 pr-5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
      >
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
    </div>
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

