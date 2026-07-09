import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type Notification,
} from '@/api/notifications';
import { parseNotification } from '@/lib/notificationParse';
import { getTaskByServerId } from '@/db/tasks';
import { useUi } from '@/stores/ui';
import { useAuth } from '@/auth/store';
import { useOnline } from '@/hooks/useOnline';
import { cn } from '@/lib/cn';

function NotificationRow({
  n,
  onOpened,
}: {
  n: Notification;
  onOpened: () => void;
}) {
  const parsed = parseNotification(n.name, n.payload);
  const qc = useQueryClient();

  const open = async () => {
    if (!n.read) {
      markNotificationRead(n.id)
        .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))
        .catch(() => {});
    }
    if (parsed.taskServerId != null) {
      const task = await getTaskByServerId(parsed.taskServerId);
      if (task) {
        const ui = useUi.getState();
        ui.setActiveView({ kind: 'project', localId: task.projectLocalId });
        ui.setSelectedTask(task.localId);
        onOpened();
      }
    }
  };

  return (
    <button
      type="button"
      onClick={() => void open()}
      className={cn(
        'flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-[var(--color-muted)]',
        n.read && 'opacity-60',
      )}
    >
      {!n.read && (
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" />
      )}
      <span className={cn('min-w-0 flex-1', n.read && 'pl-3.5')}>
        <span className="block">{parsed.text}</span>
        {n.created && (
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {new Date(n.created).toLocaleString()}
          </span>
        )}
      </span>
    </button>
  );
}

/** In-app notification inbox (Vikunja GET /notifications), own 60s poll. */
export function NotificationBell() {
  const isAuthed = useAuth((s) => s.status.kind === 'authenticated');
  const online = useOnline();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications(),
    enabled: isAuthed && online,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const unread = notifications.filter((n) => !n.read).length;

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
          className="relative rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-[var(--color-primary)]" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Notifications
          </p>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              <Check className="h-3 w-3" />
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 space-y-0.5 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="py-4 text-center text-xs text-[var(--color-muted-foreground)]">
              {online ? 'Nothing here yet.' : 'Offline — notifications need a connection.'}
            </p>
          ) : (
            notifications.map((n) => (
              <NotificationRow key={n.id} n={n} onOpened={() => setOpen(false)} />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
