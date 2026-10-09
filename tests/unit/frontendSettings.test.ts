import { describe, expect, it } from 'vitest';
import {
  applySettingsChange,
  frontendSettingsOf,
  quickAddMagicModeOf,
  settingsOf,
} from '@/sync/frontendSettings';
import { SETTINGS_DEFAULTS } from '@/api/userSettings';

// Shaped like GET /user's `settings` on current upstream Vikunja, with keys
// Cria knows nothing about, which must survive every save untouched.
const SERVER = {
  name: 'Jake',
  email_reminders_enabled: true,
  discoverable_by_name: true,
  discoverable_by_email: false,
  overdue_tasks_reminders_enabled: true,
  overdue_tasks_reminders_time: '08:30',
  default_project_id: 7,
  week_start: 0,
  language: 'de',
  timezone: 'Europe/London',
  extra_settings_links: {},
  frontend_settings: {
    quick_add_magic_mode: 'todoist',
    color_schema: 'dark',
    sidebar_width: 320,
    quick_add_default_reminders: [{ relative_period: -3600 }],
    some_future_key: { nested: [1, 2] },
    cria: { colorScheme: 'light', dateFormat: 'DD/MM/YYYY' },
  },
};

describe('frontend settings readers', () => {
  it('reads the blob and the mode through one path', () => {
    const user = { raw: { settings: SERVER } } as never;
    const fs = frontendSettingsOf(settingsOf(user));
    expect(fs).toBe(SERVER.frontend_settings);
    expect(quickAddMagicModeOf(fs)).toBe('todoist');
  });

  it('treats a missing, null or non-object blob as empty', () => {
    expect(settingsOf(null)).toBeUndefined();
    expect(frontendSettingsOf(undefined)).toEqual({});
    expect(frontendSettingsOf({ frontend_settings: null })).toEqual({});
    expect(frontendSettingsOf({ frontend_settings: '{"a":1}' })).toEqual({});
    expect(frontendSettingsOf({ frontend_settings: [1] })).toEqual({});
  });

  it('only accepts known modes', () => {
    expect(quickAddMagicModeOf({ quick_add_magic_mode: 'disabled' })).toBe('disabled');
    expect(quickAddMagicModeOf({ quick_add_magic_mode: 'Todoist' })).toBeNull();
    expect(quickAddMagicModeOf({ quickAddMagicMode: 'todoist' })).toBeNull();
    expect(quickAddMagicModeOf({})).toBeNull();
  });
});

describe('applySettingsChange', () => {
  it('changes one top-level field and passes everything else through', () => {
    const body = applySettingsChange(SERVER, { settings: { week_start: 1 } });
    expect(body).toEqual({ ...SERVER, week_start: 1 });
    // Untouched frontend_settings goes back as the very same value.
    expect(body.frontend_settings).toBe(SERVER.frontend_settings);
  });

  it('sets one frontend key and keeps every other key, known or not', () => {
    const body = applySettingsChange(SERVER, { frontend: { quick_add_magic_mode: 'disabled' } });
    expect(body.frontend_settings).toEqual({ ...SERVER.frontend_settings, quick_add_magic_mode: 'disabled' });
    expect({ ...body, frontend_settings: undefined }).toEqual({ ...SERVER, frontend_settings: undefined });
  });

  it('merges Cria prefs key by key, keeping ones it was not asked to change', () => {
    const body = applySettingsChange(SERVER, { cria: { colorScheme: 'dark' } });
    expect(body.frontend_settings).toEqual({
      ...SERVER.frontend_settings,
      cria: { colorScheme: 'dark', dateFormat: 'DD/MM/YYYY' },
    });
  });

  it('starts a frontend blob when the server has none, and fills defaults an old server omits', () => {
    const body = applySettingsChange({ name: 'Old', frontend_settings: null }, { cria: { timeFormat: '12h' } });
    expect(body).toEqual({
      ...SETTINGS_DEFAULTS,
      name: 'Old',
      frontend_settings: { cria: { timeFormat: '12h' } },
    });
  });

  it('leaves a null blob as null when the change does not touch it', () => {
    expect(applySettingsChange({ frontend_settings: null }, { settings: { name: 'x' } }).frontend_settings).toBeNull();
  });
});
