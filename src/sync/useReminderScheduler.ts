import { useEffect } from 'react';
import { useAuth } from '@/auth/store';
import { listUnnotifiedReminders, markReminderNotified } from '@/db/reminders';
import { nativeNotify } from '@/utils/notify';
import {
  scheduleNotification,
  pendingNotificationIds,
  cancelNotifications,
  isPermissionGranted,
  requestPermission,
  registerReminderActions,
  onNotificationAction,
  REMINDER_ACTION_TYPE,
} from '@/tauri/notification';
import { useSettings } from '@/stores/settings';
import { subscribe } from '@/db/bus';
import { updateTask } from '@/db/tasks';
import { useUi } from '@/stores/ui';
import { isMobilePlatform } from '@/lib/platform';
import { onVisibilityChange } from '@/lib/visibility';

const TICK_MS = 30_000;
// iOS caps an app at 64 pending local notifications. Stay under it and schedule
// the soonest reminders; the rest get scheduled on the next reconcile as these
// fire and roll off the pending list.
const MAX_SCHEDULED = 60;
// How far a "Snooze" action pushes a reminder out.
const SNOOZE_MS = 10 * 60_000;

/**
 * Stable 31-bit notification id for a reminder. Re-scheduling the same id
 * replaces (rather than duplicates) the pending notification, which is what
 * lets the mobile reconcile loop run idempotently and diff against the OS's
 * pending list.
 */
function reminderNotifId(taskLocalId: string, reminderAt: string): number {
  const s = `${taskLocalId}|${reminderAt}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_147_483_647;
}

/**
 * Mobile delivery: hand future reminders to the OS via the notification
 * plugin's schedule API, so they fire even when the app is closed or
 * backgrounded (a JS timer can't — iOS suspends it). The reconcile loop keeps
 * the OS's pending set in sync with local reminders:
 *  - schedule future reminders the OS doesn't have yet;
 *  - cancel pending ones whose reminder was deleted / completed / rescheduled
 *    (its id is gone), leaving past-due-but-still-live ones for the OS to fire.
 *
 * We never set `notified` here: the OS owns delivery and the app usually isn't
 * running when a notification fires, so there's nothing to mark. Idempotency
 * comes from the stable id + pending-list diff instead. Returns a cleanup fn.
 */
function startScheduledReminders(): () => void {
  let disposed = false;
  let inFlight: Promise<void> | null = null;
  let queued = false;
  // Ad-hoc snoozed-notification ids — not backed by a reminder row, so the
  // reconcile loop must NOT cancel them as "stale".
  const snoozed = new Set<number>();

  const reconcile = async (): Promise<void> => {
    const reminders = await listUnnotifiedReminders().catch(() => []);
    const now = Date.now();
    const liveIds = new Set(
      reminders.map((r) => reminderNotifId(r.taskLocalId, r.reminderAt)),
    );
    const pendingIds = new Set(await pendingNotificationIds().catch(() => []));

    // Notifications turned off in app settings → clear everything we scheduled.
    if (!useSettings.getState().notificationsEnabled) {
      if (pendingIds.size) await cancelNotifications([...pendingIds]);
      return;
    }

    // Drop OS notifications whose reminder no longer exists. Keyed on id, so a
    // rescheduled reminder (new time → new id) cancels the old and schedules
    // the new below. Past-due-but-live ids stay, so the OS can still fire them.
    const stale = [...pendingIds].filter((id) => !liveIds.has(id) && !snoozed.has(id));
    if (stale.length) await cancelNotifications(stale);

    const future = reminders
      .filter((r) => {
        const t = Date.parse(r.reminderAt);
        return Number.isFinite(t) && t > now;
      })
      .sort((a, b) => Date.parse(a.reminderAt) - Date.parse(b.reminderAt))
      .slice(0, MAX_SCHEDULED);
    if (future.length === 0) return;

    // Ask for permission only when there's actually something to schedule, so
    // users who never set a reminder are never prompted.
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (!granted) return;

    for (const r of future) {
      const id = reminderNotifId(r.taskLocalId, r.reminderAt);
      if (pendingIds.has(id)) continue; // already scheduled with the OS
      await scheduleNotification({
        id,
        title: 'Reminder',
        body: r.taskTitle || 'Task reminder',
        at: new Date(r.reminderAt),
        actionTypeId: REMINDER_ACTION_TYPE,
        extra: { taskLocalId: r.taskLocalId },
      });
    }
  };

  // Serialise triggers: coalesce any that arrive mid-run into one re-run, so a
  // burst of bus events (e.g. a sync pull) collapses to a single reconcile.
  const trigger = (): void => {
    if (disposed) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = reconcile()
      .catch((err) => console.warn('[reminder-scheduler] reconcile failed:', err))
      .finally(() => {
        inFlight = null;
        if (queued && !disposed) {
          queued = false;
          trigger();
        }
      });
  };

  trigger(); // initial sync on mount
  // Reminder create/delete and sync pulls both notify('tasks').
  const unsubTasks = subscribe('tasks', trigger);
  // Re-sync on foreground in case reminders changed on another device while away.
  const stopVisibility = onVisibilityChange({ onShow: trigger });

  // Notification interactions: register the Complete/Snooze buttons and route
  // taps. A plain tap opens the task; Complete marks it done; Snooze re-fires
  // the reminder in SNOOZE_MS (its id is tracked in `snoozed` so reconcile
  // won't cancel it). taskLocalId rides along in each notification's `extra`.
  void registerReminderActions();
  const stopActions = onNotificationAction((e) => {
    const taskLocalId =
      typeof e.extra.taskLocalId === 'string' ? e.extra.taskLocalId : null;
    if (!taskLocalId) return;
    if (e.actionId === 'complete') {
      void updateTask(taskLocalId, { done: true }).catch((err) =>
        console.warn('[reminder-scheduler] complete action failed:', err),
      );
    } else if (e.actionId === 'snooze') {
      const at = new Date(Date.now() + SNOOZE_MS);
      const id = reminderNotifId(taskLocalId, `snooze:${at.getTime()}`);
      snoozed.add(id);
      void scheduleNotification({
        id,
        title: 'Reminder',
        body: e.body || 'Task reminder',
        at,
        actionTypeId: REMINDER_ACTION_TYPE,
        extra: { taskLocalId },
      }).catch((err) =>
        console.warn('[reminder-scheduler] snooze reschedule failed:', err),
      );
    } else {
      // Plain tap → open the task's detail.
      useUi.getState().setSelectedTask(taskLocalId);
    }
  });

  return () => {
    disposed = true;
    unsubTasks();
    stopVisibility();
    void stopActions.then((un) => un()).catch(() => {});
  };
}

/**
 * Desktop delivery: poll for due reminders and fire them immediately while the
 * app/tray is running, marking each notified so it won't re-fire. If the app is
 * fully quit it won't fire (Vikunja's server still sends its own reminder
 * notifications) — acceptable on desktop, where the app is typically running.
 *
 * "Due now" is decided here in JS (Date comparison) rather than in SQL, to
 * sidestep ISO-string-compare pitfalls across timezone offsets.
 */
function startPollingReminders(): () => void {
  let cancelled = false;

  const tick = async () => {
    try {
      const reminders = await listUnnotifiedReminders();
      const now = Date.now();
      for (const r of reminders) {
        if (cancelled) return;
        const at = new Date(r.reminderAt).getTime();
        if (Number.isNaN(at) || at > now) continue; // not due yet
        const fired = await nativeNotify('Reminder', r.taskTitle);
        // Only mark notified if the OS actually accepted delivery — otherwise a
        // "notifications off" period would silently burn reminders the user
        // expected to see, and re-enabling permission wouldn't recover them.
        if (fired) await markReminderNotified(r.taskLocalId, r.reminderAt);
      }
    } catch (err) {
      console.warn('[reminder-scheduler] tick failed:', err);
    }
  };

  void tick(); // run once on mount
  const id = setInterval(() => {
    if (!cancelled) void tick();
  }, TICK_MS);
  return () => {
    cancelled = true;
    clearInterval(id);
  };
}

/**
 * Fires task reminders for the authenticated user. On mobile the OS owns
 * delivery via scheduled local notifications, so reminders fire even when the
 * app is closed; on desktop a polling timer fires them while the app runs.
 * Mount once at the app root.
 */
export function useReminderScheduler(): void {
  const isAuthed = useAuth((s) => s.status.kind === 'authenticated');

  useEffect(() => {
    if (!isAuthed) return;
    return isMobilePlatform()
      ? startScheduledReminders()
      : startPollingReminders();
  }, [isAuthed]);
}
