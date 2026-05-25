// Stub for Tauri autostart API. M4 will swap in
// @tauri-apps/plugin-autostart calls so the user's toggle actually
// persists across launches. Kept as a no-op now so the UI doesn't crash.

export async function isEnabled(): Promise<boolean> {
  return false;
}

export async function enable(): Promise<void> {
  // TODO(M4): wire to @tauri-apps/plugin-autostart
}

export async function disable(): Promise<void> {
  // TODO(M4): wire to @tauri-apps/plugin-autostart
}
