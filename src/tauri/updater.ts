/**
 * Wrapper around @tauri-apps/plugin-updater so feature code imports
 * a stable shape regardless of plugin churn.
 *
 * The plugin handles signature verification (against the pubkey in
 * tauri.conf.json) and the actual binary swap on next relaunch. We
 * just orchestrate: check → download → install → relaunch.
 */

import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface AvailableUpdate {
  version: string;
  notes: string | null;
  date: string | null;
  /** Underlying handle. Calling code shouldn't touch this; use the helpers. */
  inner: Update;
}

/**
 * Check the configured endpoints for a newer build. Resolves to the
 * Update handle if one is available, or null if the running version is
 * already current.
 *
 * In dev (`tauri dev`) or when the endpoint 404s, this throws — callers
 * should catch and treat as "no update right now."
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? null,
    date: update.date ?? null,
    inner: update,
  };
}

/**
 * Downloads + installs the update bundle. After install completes, the
 * app must relaunch for the swap to take effect; this helper does both.
 *
 * The Update handle is single-use — once `downloadAndInstall` runs, it
 * can't be reused. Callers should re-check on next launch if needed.
 */
export async function installUpdate(update: AvailableUpdate): Promise<void> {
  await update.inner.downloadAndInstall();
  await relaunch();
}
