import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Bell } from 'lucide-react';
import { listRemindersForTask, type TaskReminder } from '@/db/reminders';
import { subscribe } from '@/db/bus';

/**
 * Read-only list of a task's reminders, shown in the detail card.
 * Mirrored locally on pull; a local scheduler fires desktop
 * notifications when they come due (see useReminderScheduler). Setting /
 * clearing reminders from Cria is the next slice — for now they're
 * managed in Vikunja's web UI and surfaced + notified here.
 */
export function ReminderList({ taskLocalId }: { taskLocalId: string }) {
  const qc = useQueryClient();
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

  if (reminders.length === 0) return null;

  return (
    <section className="mb-4">
      <h3 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        <Bell className="h-3 w-3" />
        Reminders
        <span className="font-normal">{reminders.length}</span>
      </h3>
      <ul className="space-y-1">
        {reminders.map((r) => (
          <li
            key={r.reminderAt}
            className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-xs"
          >
            <Bell className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
            <span className="flex-1">{formatReminder(r.reminderAt)}</span>
          </li>
        ))}
      </ul>
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
