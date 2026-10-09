/**
 * Reading and changing Vikunja's `settings.frontend_settings`, the free-form
 * JSON blob the server stores and returns verbatim (upstream
 * `models.UserGeneralSettings.FrontendSettings`, typed `any`). Vikunja-web
 * keeps its own prefs there (snake_case keys such as `color_schema`,
 * `quick_add_magic_mode`) and so may other clients; Cria keeps its prefs under
 * a `cria` key.
 *
 * Pure: no store, no network. The one rule: a change sets only the keys it
 * names and passes every other key through untouched, known or not.
 */

import { SETTINGS_DEFAULTS, type UserSettingsInput } from '@/api/userSettings';
import type { User } from '@/domain/user';
import { isQuickAddMagicMode, type QuickAddMagicMode } from '@/lib/quickAddPrefixes';

/** Cria's own namespace inside frontend_settings. */
export const CRIA_KEY = 'cria';
/** Vikunja-web's key for the Quick Add Magic mode, shared on purpose. */
export const QUICK_ADD_MAGIC_KEY = 'quick_add_magic_mode';

type Blob = Record<string, unknown>;

function asObject(value: unknown): Blob | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Blob) : null;
}

/** `user.raw.settings`, the server's general settings object. */
export function settingsOf(user: User | null | undefined): Blob | undefined {
  return asObject(asObject(user?.raw)?.settings) ?? undefined;
}

/** The frontend_settings blob of a settings object; `{}` when unset or not an object. */
export function frontendSettingsOf(settings: Blob | undefined): Blob {
  return asObject(settings?.frontend_settings) ?? {};
}

/** The user's Quick Add Magic mode, or null when unset or not a known mode. */
export function quickAddMagicModeOf(frontendSettings: Blob): QuickAddMagicMode | null {
  const mode = frontendSettings[QUICK_ADD_MAGIC_KEY];
  return isQuickAddMagicMode(mode) ? mode : null;
}

/** Cria's namespaced prefs, or null when absent. */
export function criaPrefsOf(frontendSettings: Blob): Blob | null {
  return asObject(frontendSettings[CRIA_KEY]);
}

/** One user change to the general settings. Anything not named is left as is. */
export interface SettingsChange {
  /** Top-level fields (name, week_start, …). */
  settings?: Omit<UserSettingsInput, 'frontend_settings'>;
  /** frontend_settings keys to set, e.g. `quick_add_magic_mode`. */
  frontend?: Blob;
  /** Cria prefs to set inside frontend_settings.cria, merged key by key. */
  cria?: Blob;
}

/**
 * The full POST body for `change`: the server's current settings with only the
 * named fields replaced. The settings POST overwrites every column (omitted
 * fields become Go zero values), so `server` must be fresh from the server,
 * never a cached copy. Defaults fill any field an older server leaves out.
 * frontend_settings goes back exactly as the server sent it unless the change
 * names a key in it.
 */
export function applySettingsChange(server: Blob | undefined, change: SettingsChange): UserSettingsInput {
  const body: UserSettingsInput = {
    ...SETTINGS_DEFAULTS,
    ...(server as UserSettingsInput | undefined),
    ...change.settings,
  };
  if (change.frontend || change.cria) {
    const frontend = frontendSettingsOf(server);
    const next: Blob = { ...frontend, ...change.frontend };
    if (change.cria) next[CRIA_KEY] = { ...criaPrefsOf(frontend), ...change.cria };
    body.frontend_settings = next;
  }
  return body;
}
