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
}): Promise<void> {
  _sendNotification({
    id: args.id,
    title: args.title,
    body: args.body,
    // repeating=false, allowWhileIdle=true → still fires under iOS low-power /
    // Android doze, which is exactly when a reminder matters.
    schedule: Schedule.at(args.at, false, true),
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
