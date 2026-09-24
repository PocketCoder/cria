import { type ApiClient, callApi, createApiClient } from './client';

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
