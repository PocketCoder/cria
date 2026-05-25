/**
 * Thin wrapper around @tauri-apps/plugin-autostart so feature code
 * imports a stable shape.
 */

import {
  enable as _enable,
  disable as _disable,
  isEnabled as _isEnabled,
} from '@tauri-apps/plugin-autostart';

export async function isEnabled(): Promise<boolean> {
  return _isEnabled();
}

export async function enable(): Promise<void> {
  await _enable();
}

export async function disable(): Promise<void> {
  await _disable();
}
