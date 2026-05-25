// Stub for Tauri globalShortcut API – no‑op implementations for development
export async function register(_shortcut: string, _handler: () => void): Promise<void> {
  // In production this registers a native shortcut. Here we do nothing.
}

export async function unregister(_shortcut: string): Promise<void> {
  // No‑op for stub.
}
