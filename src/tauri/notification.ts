/**
 * Thin wrapper around @tauri-apps/plugin-notification. Lives in
 * src/tauri/ so feature code imports a stable shape regardless of the
 * underlying plugin's API churn.
 */

import {
  isPermissionGranted as _isPermissionGranted,
  requestPermission as _requestPermission,
  sendNotification as _sendNotification,
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
