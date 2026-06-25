/**
 * Sync display preferences across devices via Vikunja's
 * `settings.frontend_settings` — a free-form JSON blob the server round-trips
 * untouched (the official web client stores its own prefs there too). We
 * namespace ours under a `cria` key so we never clobber other clients' keys.
 *
 * Why: theme / date-format / time-format / done-sound are otherwise local-only
 * (zustand → localStorage), which iOS can evict — so they "reset despite being
 * set many times". Storing them server-side restores them on every launch and
 * shares them across a user's devices.
 *
 * Device-specific settings (tray, autostart, notification permission, the
 * shopping default *project id* which is a per-device local id) stay local and
 * are intentionally NOT synced.
 */

import { useSettings, type ColorScheme, type DateFormat, type TimeFormat } from '@/stores/settings';
import { pushUserSettings, type UserSettingsInput } from '@/api/userSettings';
import { getCachedUser } from '@/db/user';
import type { User } from '@/domain/user';

const CRIA_KEY = 'cria';
const PUSH_DEBOUNCE_MS = 800;

export interface SyncedPrefs {
  colorScheme: ColorScheme;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  playSoundWhenDone: boolean;
}

function currentPrefs(): SyncedPrefs {
  const s = useSettings.getState();
  return {
    colorScheme: s.colorScheme,
    dateFormat: s.dateFormat,
    timeFormat: s.timeFormat,
    playSoundWhenDone: s.playSoundWhenDone,
  };
}

/** While we apply server values to the local store, suppress the echo back. */
let applyingRemote = false;
/** Hydrate from the server only once per session, so a later 60s user refetch
 *  can't revert a change the user just made before it finished pushing. */
let hydratedOnce = false;

function frontendSettingsOf(user: User | null): Record<string, unknown> {
  const settings = (user?.raw as Record<string, unknown> | undefined)?.settings as
    | Record<string, unknown>
    | undefined;
  const fs = settings?.frontend_settings;
  return fs && typeof fs === 'object' ? (fs as Record<string, unknown>) : {};
}

function criaPrefsOf(frontendSettings: Record<string, unknown>): Partial<SyncedPrefs> | null {
  const cria = frontendSettings[CRIA_KEY];
  return cria && typeof cria === 'object' ? (cria as Partial<SyncedPrefs>) : null;
}

/**
 * Build the `frontend_settings` object to send to the server: the user's
 * existing blob with Cria's prefs merged in. Exported so SettingsModal's other
 * pushes (name, reminders) can include the live prefs and never clobber them.
 */
export function frontendSettingsWithCria(existing: unknown): Record<string, unknown> {
  const base = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
  return { ...base, [CRIA_KEY]: currentPrefs() };
}

/** Apply server-stored prefs to the local store once. No echo back to server. */
export function maybeHydrateSyncedPrefs(user: User | null): void {
  if (hydratedOnce || !user) return;
  const prefs = criaPrefsOf(frontendSettingsOf(user));
  hydratedOnce = true; // mark even if absent, so we don't re-check every refetch
  if (!prefs) return;
  applyingRemote = true;
  try {
    const s = useSettings.getState();
    if (prefs.colorScheme && prefs.colorScheme !== s.colorScheme) s.setColorScheme(prefs.colorScheme);
    if (prefs.dateFormat && prefs.dateFormat !== s.dateFormat) s.setDateFormat(prefs.dateFormat);
    if (prefs.timeFormat && prefs.timeFormat !== s.timeFormat) s.setTimeFormat(prefs.timeFormat);
    if (typeof prefs.playSoundWhenDone === 'boolean' && prefs.playSoundWhenDone !== s.playSoundWhenDone) {
      s.setPlaySoundWhenDone(prefs.playSoundWhenDone);
    }
  } finally {
    applyingRemote = false;
  }
}

/** Push the local synced prefs into the server's frontend_settings, preserving
 *  the rest of the settings object and any other frontend_settings keys. */
export async function pushSyncedPrefs(): Promise<void> {
  const user = await getCachedUser();
  if (!user) return; // not signed in / not cached yet — a later change retries
  const serverSettings = (user.raw as Record<string, unknown>)?.settings as
    | Record<string, unknown>
    | undefined;
  const body: UserSettingsInput = {
    // Round-trip the server's current settings untouched (the endpoint
    // overwrites every column), only replacing frontend_settings.
    ...(serverSettings as UserSettingsInput | undefined),
    frontend_settings: frontendSettingsWithCria(serverSettings?.frontend_settings),
  };
  await pushUserSettings(body);
}

/**
 * Subscribe once (mount in App): debounce-push synced prefs whenever they
 * change, unless we're the ones applying server values. Returns an unsubscribe.
 */
export function startSettingsSync(): () => void {
  let prev = JSON.stringify(currentPrefs());
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = useSettings.subscribe(() => {
    if (applyingRemote) {
      prev = JSON.stringify(currentPrefs());
      return;
    }
    const next = JSON.stringify(currentPrefs());
    if (next === prev) return;
    prev = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void pushSyncedPrefs().catch((e) => console.warn('[settings-sync] push failed:', e));
    }, PUSH_DEBOUNCE_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsub();
  };
}
