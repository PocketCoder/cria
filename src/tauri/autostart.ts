// Stub for Tauri autostart API – no‑op during development
export async function isEnabled(): Promise<boolean> {
  return false; // Assume disabled by default
}

export async function enable(): Promise<void> {
  console.log('Autostart enabled (stub)');
}

export async function disable(): Promise<void> {
  console.log('Autostart disabled (stub)');
}
