/**
 * Thin wrapper around @tauri-apps/plugin-notification. Lives in
 * src/tauri/ so feature code imports a stable shape regardless of the
 * underlying plugin's API churn.
 */

import {
  isPermissionGranted as _isPermissionGranted,
  requestPermission as _requestPermission,
  sendNotification as _sendNotification,
  pending as _pending,
  cancel as _cancel,
  registerActionTypes as _registerActionTypes,
  onAction as _onAction,
  Schedule,
} from '@tauri-apps/plugin-notification';

export async function isPermissionGranted(): Promise<boolean> {
  return _isPermissionGranted();
}

export async function requestPermission(): Promise<'granted' | 'denied'> {
  const result = await _requestPermission();
  return result === 'granted' ? 'granted' : 'denied';
}

export async function sendNotification(args: {
  title: string;
  body: string;
}): Promise<void> {
  _sendNotification({ title: args.title, body: args.body });
}

/**
 * Schedule a local notification to fire at a future time. Unlike
 * sendNotification (immediate, only while the app runs), the OS owns delivery
 * here — it fires even when the app is closed/backgrounded. This is how
 * reminders work on mobile, where a JS timer can't run in the background.
 *
 * `id` is a stable per-reminder key: re-scheduling the same id replaces the
 * pending notification rather than duplicating it, which is what lets the
 * reconcile loop be idempotent.
 */
export async function scheduleNotification(args: {
  id: number;
  title: string;
  body: string;
  at: Date;
  /** Action-type id whose buttons appear on the notification (see registerReminderActions). */
  actionTypeId?: string;
  /** Arbitrary payload echoed back to onNotificationAction (e.g. the task id). */
  extra?: Record<string, unknown>;
}): Promise<void> {
  _sendNotification({
    id: args.id,
    title: args.title,
    body: args.body,
    // repeating=false, allowWhileIdle=true → still fires under iOS low-power /
    // Android doze, which is exactly when a reminder matters.
    schedule: Schedule.at(args.at, false, true),
    ...(args.actionTypeId ? { actionTypeId: args.actionTypeId } : {}),
    ...(args.extra ? { extra: args.extra } : {}),
  });
}

/** Ids of notifications the OS has scheduled but not yet fired. */
export async function pendingNotificationIds(): Promise<number[]> {
  const list = await _pending();
  return list.map((p) => p.id);
}

/** Cancel scheduled (pending) notifications by id. No-op for an empty list. */
export async function cancelNotifications(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await _cancel(ids);
}

/** Action-type id for reminder notifications (Complete / Snooze buttons). */
export const REMINDER_ACTION_TYPE = 'cria.reminder';

/**
 * Register the reminder notification's action buttons (Complete / Snooze) with
 * the OS, once, before scheduling reminders. Best-effort (iOS-only in practice;
 * desktop notifications in this app don't carry buttons).
 */
export async function registerReminderActions(): Promise<void> {
  try {
    await _registerActionTypes([
      {
        id: REMINDER_ACTION_TYPE,
        actions: [
          { id: 'complete', title: 'Complete' },
          { id: 'snooze', title: 'Snooze' },
        ],
      },
    ]);
  } catch (err) {
    console.warn('[notification] registerReminderActions failed:', err);
  }
}

export interface NotificationActionEvent {
  /** Tapped action id ('complete' / 'snooze'); null or other for a plain tap. */
  actionId: string | null;
  /** The `extra` payload attached when scheduling (carries taskLocalId). */
  extra: Record<string, unknown>;
  /** The notification body (the task title), if present. */
  body: string | null;
}

/**
 * Subscribe to notification taps and action-button presses ('actionPerformed').
 * The plugin types the payload loosely and the runtime shape varies by
 * platform, so we normalise defensively. Returns an unlisten function.
 */
export async function onNotificationAction(
  cb: (e: NotificationActionEvent) => void,
): Promise<() => void> {
  const listener = await _onAction((payload) => {
    const p = (payload ?? {}) as unknown as Record<string, unknown> & {
      notification?: Record<string, unknown>;
    };
    const n = (p.notification as Record<string, unknown> | undefined) ?? p;
    const actionId =
      (typeof p.actionId === 'string' ? (p.actionId as string) : null) ??
      (typeof p.action === 'string' ? (p.action as string) : null);
    const extra =
      ((n.extra ?? p.extra) as Record<string, unknown> | undefined) ?? {};
    const body = typeof n.body === 'string' ? (n.body as string) : null;
    cb({ actionId, extra, body });
  });
  return () => void listener.unregister();
}
