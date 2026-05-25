import { isPermissionGranted, requestPermission, sendNotification } from '@/tauri/notification';

/** Simple wrapper to send a native notification, requesting permission if needed */
export async function nativeNotify(title: string, body: string) {
  let granted = await isPermissionGranted();
  if (!granted) {
    const res = await requestPermission();
    granted = res === 'granted';
  }
  if (granted) {
    await sendNotification({ title, body });
  }
}
