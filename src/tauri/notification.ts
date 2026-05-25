// Stub for Tauri notification API. M4 will swap in
// @tauri-apps/plugin-notification calls; for now this is a no-op so the
// rest of the code can wire to it without exploding.

export async function isPermissionGranted(): Promise<boolean> {
  return true;
}

export async function requestPermission(): Promise<'granted' | 'denied'> {
  return 'granted';
}

export async function sendNotification(_: {
  title: string;
  body: string;
}): Promise<void> {
  // TODO(M4): wire to @tauri-apps/plugin-notification
}
