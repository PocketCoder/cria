import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertTriangle, Bell, Plus, X } from 'lucide-react';
import {
  listRemindersForTask,
  addReminder,
  removeReminder,
  type TaskReminder,
} from '@/db/reminders';
import { subscribe } from '@/db/bus';
import { notificationsAllowed, openNotificationSettings } from '@/utils/notify';

/**
 * Reminders for a task: list + add (datetime picker) + remove. Edits go
 * through the task-update outbox path (reminders are a task field in
 * Vikunja); a local scheduler fires desktop notifications when they come
 * due (see useReminderScheduler).
 */
export function ReminderList({ taskLocalId }: { taskLocalId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

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
  // dialog once per app install — after that it returns the current
  // value silently — so once the user has denied (or disabled
  // Notifications in System Settings), there's no way to re-prompt from
  // JS. Best we can do is surface the state and deep-link them to the
  // settings pane. Refetched on tab focus so toggling the OS setting
  // and coming back updates the UI without a full reload.
  const { data: notifyOk = true, refetch: recheckNotify } = useQuery({
    queryKey: ['notifications-allowed'],
    queryFn: notificationsAllowed,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const handleAdd = async () => {
    if (!draft) return;
    const at = new Date(draft); // datetime-local is in local time
    if (Number.isNaN(at.getTime())) return;
    try {
      await addReminder(taskLocalId, at.toISOString());
      setDraft('');
      setAdding(false);
    } catch (err) {
      console.error('[reminders] add failed:', err);
    }
  };

  const handleRemove = async (reminderAt: string) => {
    try {
      await removeReminder(taskLocalId, reminderAt);
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
              key={r.reminderAt}
              className="group flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-xs"
            >
              <Bell className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
              <span className="flex-1">{formatReminder(r.reminderAt)}</span>
              <button
                type="button"
                onClick={() => void handleRemove(r.reminderAt)}
                aria-label="Remove reminder"
                className="shrink-0 rounded p-0.5 text-[var(--color-muted-foreground)] opacity-0 transition-opacity hover:text-[var(--color-warning)] group-hover:opacity-100 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {adding && !notifyOk ? (
        <div className="mb-1 flex items-start gap-2 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-2 py-1.5 text-xs text-[var(--color-warning)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1 leading-snug text-[var(--color-foreground)]">
            Notifications are disabled for Cria — reminders you add here
            won't fire.
            <button
              type="button"
              onClick={() => {
                void openNotificationSettings();
                // User likely about to flip the OS toggle; re-check when
                // they come back to the app.
                void recheckNotify();
              }}
              className="ml-1 underline underline-offset-2 hover:opacity-80 cursor-pointer"
            >
              Open System Settings
            </button>
          </div>
        </div>
      ) : null}
      {adding ? (
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAdd();
              } else if (e.key === 'Escape') {
                setAdding(false);
                setDraft('');
              }
            }}
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!draft}
            className="rounded-md bg-[var(--color-primary)] px-2 py-1 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            Add
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            // Seed a real value (1h from now, local). WebKit renders an
            // empty datetime-local as a greyed placeholder showing "now",
            // which looks filled but leaves the value "" — so without a
            // seed the Add button stays (correctly) disabled.
            setDraft(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
            setAdding(true);
          }}
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          Add reminder
        </button>
      )}
    </section>
  );
}

function formatReminder(iso: string): string {
  try {
    return format(new Date(iso), 'd MMM yyyy, HH:mm');
  } catch {
    return iso;
  }
}

/** Format a Date as a `datetime-local` value (local time, minute
 * precision) — not toISOString(), which would be UTC. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
