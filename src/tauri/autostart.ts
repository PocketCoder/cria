/**
 * Thin wrapper around @tauri-apps/plugin-autostart so feature code
 * imports a stable shape.
 */

import {
  enable as _enable,
  disable as _disable,
  isEnabled as _isEnabled,
} from '@tauri-apps/plugin-autostart';
import { isMobilePlatform } from '@/lib/platform';

// Launch-at-login is a desktop concept; the plugin isn't compiled on mobile.
// The "Launch at login" setting is also hidden on mobile, but these guards
// keep the wrappers safe if ever called.
export async function isEnabled(): Promise<boolean> {
  if (isMobilePlatform()) return false;
  return _isEnabled();
}

export async function enable(): Promise<void> {
  if (isMobilePlatform()) return;
  await _enable();
}

export async function disable(): Promise<void> {
  if (isMobilePlatform()) return;
  await _disable();
}
