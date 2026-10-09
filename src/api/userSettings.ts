import { type ApiClient, callApi, createApiClient, createApiFetch } from './client';
import { NetworkError, buildApiError } from './errors';

/**
 * Mirrors the writable fields of Vikunja's `v1.UserSettings`. The
 * `/user/settings/general` endpoint overwrites *every* column from the
 * request body — omitted fields are persisted as Go zero values — so a
 * caller that wants to change one field must still send the complete,
 * current object. The fields below the editable set (default project,
 * discoverability, frontend blob) aren't surfaced in the UI but are
 * included here so they can be round-tripped untouched.
 */
export interface UserSettingsInput {
  language?: string;
  timezone?: string;
  week_start?: number;
  name?: string;
  email_reminders_enabled?: boolean;
  overdue_tasks_reminders_enabled?: boolean;
  overdue_tasks_reminders_time?: string;
  default_project_id?: number;
  discoverable_by_email?: boolean;
  discoverable_by_name?: boolean;
  frontend_settings?: unknown;
}

/**
 * Defaults for every field Vikunja's UpdateUser with forceOverride=true would
 * zero-out if omitted from the POST body. Spread before user overrides so no
 * field is ever lost.
 */
export const SETTINGS_DEFAULTS: UserSettingsInput = {
  language: 'en',
  timezone: 'UTC',
  week_start: 1,
  email_reminders_enabled: false,
  overdue_tasks_reminders_enabled: false,
  overdue_tasks_reminders_time: '09:00',
  default_project_id: 0,
  discoverable_by_email: false,
  discoverable_by_name: false,
};

/**
 * POST the full settings object to the server. Callers must pass the
 * complete object (not a partial patch) — see the note on
 * {@link UserSettingsInput} for why a partial body silently clears the
 * fields it omits.
 */
export async function pushUserSettings(
  settings: UserSettingsInput,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/user/settings/general', {
      body: settings,
    }),
  );
}

/**
 * A JSON merge-patch (RFC 7386) for v2's settings PATCH: only the fields
 * being changed. `frontend_settings` is merged into the stored blob key by
 * key, recursing into nested objects.
 */
export type UserSettingsPatch = Omit<UserSettingsInput, 'frontend_settings'> & {
  frontend_settings?: Record<string, unknown>;
};

/** What a v2 settings PATCH did: applied, or the server doesn't offer it. */
export type SettingsPatchResult = 'saved' | 'unsupported';

/**
 * Statuses meaning the server has no v2 settings PATCH, so nothing was
 * written: 404 before Vikunja v2.4.0 (no `/api/v2`), 405 on v2.4.0 to v2.6.0
 * (the path takes PUT only), 501 from a proxy that doesn't know the method.
 */
const PATCH_UNSUPPORTED = new Set([404, 405, 501]);

/**
 * PATCH `/api/v2/user/settings/general` (Vikunja v2.7.0+) with a merge-patch.
 * The server reads its current settings, merges `patch` in, and writes the
 * result, so fields the patch doesn't name keep whatever the server holds,
 * even if another client changed them a moment ago. A patch that changes
 * nothing gets an empty 304.
 *
 * Returns `'unsupported'` when the server has no such endpoint (see
 * {@link PATCH_UNSUPPORTED}, plus a 2xx that isn't Vikunja's JSON, e.g. a
 * proxy's HTML fallback page); the caller then falls back to
 * {@link pushUserSettings}. Any other failure throws.
 */
export async function patchUserSettings(
  patch: UserSettingsPatch,
  apiFetch: ReturnType<typeof createApiFetch> = createApiFetch('v2'),
): Promise<SettingsPatchResult> {
  let res: Response;
  try {
    res = await apiFetch('/user/settings/general', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json', Accept: 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch (err) {
    throw new NetworkError(err instanceof Error ? err.message : 'Network request failed', err);
  }
  if (res.status === 304) return 'saved';
  if (PATCH_UNSUPPORTED.has(res.status)) return 'unsupported';
  if (res.ok) return (res.headers.get('content-type') ?? '').includes('json') ? 'saved' : 'unsupported';
  throw buildApiError(res.status, await problemOf(res));
}

/** v2 errors are RFC 9457 problem+json: Vikunja's message is `detail`. */
async function problemOf(res: Response): Promise<{ code?: number; message?: string } | null> {
  try {
    const body = (await res.json()) as { code?: number; message?: string; detail?: string; title?: string };
    return { code: body.code, message: body.detail || body.message || body.title };
  } catch {
    return null;
  }
}
