/**
 * Thin wrapper around @tauri-apps/plugin-global-shortcut.
 *
 * The plugin's handler fires with a `ShortcutEvent` carrying the
 * shortcut string and a state (`Pressed` | `Released`). We forward only
 * `Pressed` so the handler doesn't double-fire on key-release.
 */

import {
  register as _register,
  unregister as _unregister,
} from '@tauri-apps/plugin-global-shortcut';

export async function register(
  shortcut: string,
  handler: () => void,
): Promise<void> {
  await _register(shortcut, (event) => {
    if (event.state === 'Pressed') handler();
  });
}

export async function unregister(shortcut: string): Promise<void> {
  await _unregister(shortcut);
}
