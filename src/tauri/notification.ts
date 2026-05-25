// Stub for Tauri notification API – logs to console during dev
export async function isPermissionGranted(): Promise<boolean> {
  return true;
}

export async function requestPermission(): Promise<'granted' | 'denied'> {
  return 'granted';
}

export async function sendNotification({ title, body }: { title: string; body: string }): Promise<void> {
  console.log('Native notification:', title, body);
}
