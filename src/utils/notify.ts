import { isPermissionGranted, requestPermission, sendNotification } from '@/tauri/notification';
import { getIdentifier } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * Send a desktop notification. Requests permission the first time (when
 * the OS hasn't yet asked the user) but does NOT retry on subsequent
 * calls — once the user has answered, macOS turns requestPermission
 * into a silent read, so re-prompting is impossible. Direct the user to
 * System Settings instead (see openNotificationSettings).
 *
 * Returns true iff the notification was actually dispatched to the OS.
 * Callers must use this to decide whether to mark the underlying
 * reminder as notified — otherwise a "permission off" period silently
 * burns reminders that the user expected to see.
 */
export async function nativeNotify(title: string, body: string): Promise<boolean> {
  let granted = await isPermissionGranted();
  if (!granted) {
    const res = await requestPermission();
    granted = res === 'granted';
  }
  if (!granted) return false;
  await sendNotification({ title, body });
  return true;
}

/**
 * Cheap status check for "can we fire reminders right now?" Returns true
 * when permission is granted, false otherwise (denied, never asked, OS
 * silenced, etc.). Used by the reminder UI to show a warning + escape
 * hatch when reminders won't actually fire.
 *
 * Does NOT prompt — call requestPermission() yourself if you want to
 * surface the OS dialog (which only appears once per app install).
 */
export async function notificationsAllowed(): Promise<boolean> {
  try {
    return await isPermissionGranted();
  } catch {
    return false;
  }
}

/**
 * Open System Settings → Notifications → this app on macOS. Falls back
 * to the general Notifications pane if the bundle identifier deep-link
 * fails. Used as the escape hatch when notifications are off and we
 * can't re-prompt (macOS only lets requestPermission prompt once).
 *
 * The URL scheme is macOS-specific; on other platforms this will just
 * be a no-op error logged to the console.
 */
export async function openNotificationSettings(): Promise<void> {
  let id: string | null = null;
  try {
    id = await getIdentifier();
  } catch {
    // ignore — fall through to generic pane
  }
  const url = id
    ? `x-apple.systempreferences:com.apple.preference.notifications?id=${id}`
    : 'x-apple.systempreferences:com.apple.preference.notifications';
  try {
    await openUrl(url);
  } catch (err) {
    console.warn('[notify] failed to open notification settings:', err);
  }
}
