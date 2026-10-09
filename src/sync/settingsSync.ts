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
 *
 * One setting is shared with Vikunja-web rather than namespaced: the Quick Add
 * Magic mode lives at web's own key, `frontend_settings.quick_add_magic_mode`,
 * so a mode picked on the web applies in Cria and vice versa.
 *
 * Every settings write goes through `saveUserSettings`: the POST replaces the
 * whole settings object, so it re-reads the server's current settings first
 * and changes only what the user changed (see AGENTS.md).
 */

import { useSettings, type ColorScheme, type DateFormat, type TimeFormat } from '@/stores/settings';
import { pushUserSettings } from '@/api/userSettings';
import { fetchCurrentUser } from '@/api/user';
import { getCachedUser } from '@/db/user';
import type { User } from '@/domain/user';
import type { QuickAddMagicMode } from '@/lib/quickAddPrefixes';
import {
  QUICK_ADD_MAGIC_KEY,
  applySettingsChange,
  criaPrefsOf,
  frontendSettingsOf,
  quickAddMagicModeOf,
  settingsOf,
  type SettingsChange,
} from '@/sync/frontendSettings';

const PUSH_DEBOUNCE_MS = 800;

export interface SyncedPrefs {
  colorScheme: ColorScheme;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  playSoundWhenDone: boolean;
}

type SyncedPrefKey = keyof SyncedPrefs;
const SYNCED_PREF_KEYS: readonly SyncedPrefKey[] = ['colorScheme', 'dateFormat', 'timeFormat', 'playSoundWhenDone'];

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
 *  can't revert a change the user just made before it finished pushing.
 *  Pinned on globalThis: an HMR reset would re-hydrate and revert settings. */
declare global {
  var __cria_settingsHydrated__: boolean | undefined;
  /** Last Quick Add Magic mode seen on the server this session. */
  var __cria_serverQuickAddMode__: QuickAddMagicMode | undefined;
  /** Tail of the settings-save queue: one GET-then-POST at a time. */
  var __cria_settingsSaveChain__: Promise<void> | undefined;
}

/**
 * Follow the server's Quick Add Magic mode. Unlike the Cria prefs this runs on
 * every user fetch, so a change made on the web reaches a running app, but it
 * only applies a value the server *changed to*: a server value equal to the
 * last one seen leaves the local mode alone, so a refetch landing before a
 * local change has finished pushing can't revert it.
 */
function followServerQuickAddMode(frontendSettings: Record<string, unknown>): void {
  const mode = quickAddMagicModeOf(frontendSettings);
  if (!mode || mode === globalThis.__cria_serverQuickAddMode__) return;
  globalThis.__cria_serverQuickAddMode__ = mode;
  const s = useSettings.getState();
  if (mode === s.quickAddMagicMode) return;
  applyingRemote = true;
  try {
    s.setQuickAddMagicMode(mode);
  } finally {
    applyingRemote = false;
  }
}

/**
 * Apply server-stored prefs to the local store: the Cria prefs once per
 * session, the Quick Add Magic mode whenever it changed server-side. No echo
 * back to the server.
 */
export function maybeHydrateSyncedPrefs(user: User | null): void {
  if (!user) return;
  const frontendSettings = frontendSettingsOf(settingsOf(user));
  followServerQuickAddMode(frontendSettings);
  if (globalThis.__cria_settingsHydrated__) return;
  const prefs = criaPrefsOf(frontendSettings) as Partial<SyncedPrefs> | null;
  globalThis.__cria_settingsHydrated__ = true; // mark even if absent, so we don't re-check every refetch
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

/**
 * Save one settings change without writing back anything stale: GET /user for
 * the server's current settings, apply only `change` on top, POST the whole
 * object. Saves run one at a time, so a second save re-reads after the first
 * has landed and neither undoes the other. Never falls back to cached
 * settings: if the GET fails, nothing is sent.
 */
export function saveUserSettings(change: SettingsChange): Promise<void> {
  const run = async () => {
    const server = settingsOf(await fetchCurrentUser());
    // A mode changed on the web since we last looked is picked up here, so
    // the body below (which keeps it) and the local parser agree. Skipped when
    // this save *is* a mode change: the user's choice wins.
    if (!change.frontend || !(QUICK_ADD_MAGIC_KEY in change.frontend)) {
      followServerQuickAddMode(frontendSettingsOf(server));
    }
    const body = applySettingsChange(server, change);
    await pushUserSettings(body);
    // The server now holds this mode; a refetch showing it is not a web change.
    const saved = quickAddMagicModeOf(frontendSettingsOf(body as Record<string, unknown>));
    if (saved) globalThis.__cria_serverQuickAddMode__ = saved;
  };
  const queued = (globalThis.__cria_settingsSaveChain__ ?? Promise.resolve()).then(run);
  globalThis.__cria_settingsSaveChain__ = queued.catch(() => undefined);
  return queued;
}

/** Push the given Cria prefs (all by default) into frontend_settings.cria. */
export async function pushSyncedPrefs(keys: readonly SyncedPrefKey[] = SYNCED_PREF_KEYS): Promise<void> {
  if (!(await getCachedUser())) return; // not signed in / not cached yet — a later change retries
  const prefs = currentPrefs();
  const cria: Partial<SyncedPrefs> = {};
  for (const k of keys) (cria as Record<string, unknown>)[k] = prefs[k];
  await saveUserSettings({ cria });
}

/**
 * Subscribe once (mount in App): debounce-push synced prefs whenever they
 * change, unless we're the ones applying server values. Only the prefs that
 * changed are sent, so another device's change to a different pref survives.
 * Returns an unsubscribe.
 */
export function startSettingsSync(): () => void {
  let prev = currentPrefs();
  let pending = new Set<SyncedPrefKey>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = useSettings.subscribe(() => {
    const next = currentPrefs();
    if (applyingRemote) {
      prev = next;
      return;
    }
    const changed = SYNCED_PREF_KEYS.filter((k) => next[k] !== prev[k]);
    prev = next;
    if (changed.length === 0) return;
    for (const k of changed) pending.add(k);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const keys = [...pending];
      pending = new Set();
      void pushSyncedPrefs(keys).catch((e) => console.warn('[settings-sync] push failed:', e));
    }, PUSH_DEBOUNCE_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsub();
  };
}
