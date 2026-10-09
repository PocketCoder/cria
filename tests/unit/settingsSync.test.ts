// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCachedUser, pushUserSettings } = vi.hoisted(() => ({
  getCachedUser: vi.fn(),
  pushUserSettings: vi.fn(),
}));
vi.mock('@/db/user', () => ({ getCachedUser }));
vi.mock('@/api/userSettings', async (orig) => ({
  ...(await orig<typeof import('@/api/userSettings')>()),
  pushUserSettings,
}));

import { pushSyncedPrefs, maybeHydrateSyncedPrefs, frontendSettingsWithCria } from '@/sync/settingsSync';
import { useSettings } from '@/stores/settings';

const user = (settings: Record<string, unknown>) => ({ raw: { settings } }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__cria_settingsHydrated__ = undefined;
  globalThis.__cria_serverQuickAddMode__ = undefined;
  useSettings.setState({ quickAddMagicMode: 'vikunja' });
});

describe('pushSyncedPrefs', () => {
  // The settings POST is a full-object replace (AGENTS.md): every server
  // field must round-trip or the server writes Go zero values over it.
  it('sends the full server settings with only frontend_settings.cria changed', async () => {
    getCachedUser.mockResolvedValue(user({
      name: 'Jake',
      default_project_id: 7,
      week_start: 1,
      frontend_settings: { otherClient: { x: 1 } },
    }));
    useSettings.getState().setColorScheme('dark');
    await pushSyncedPrefs();
    const body = pushUserSettings.mock.calls[0]![0];
    expect(body).toMatchObject({ name: 'Jake', default_project_id: 7, week_start: 1 });
    expect(body.frontend_settings.otherClient).toEqual({ x: 1 });
    expect(body.frontend_settings.cria.colorScheme).toBe('dark');
  });

  it('does nothing when no user is cached', async () => {
    getCachedUser.mockResolvedValue(null);
    await pushSyncedPrefs();
    expect(pushUserSettings).not.toHaveBeenCalled();
  });
});

describe('maybeHydrateSyncedPrefs', () => {
  it('applies server prefs once per session, never again', () => {
    useSettings.getState().setColorScheme('light');
    maybeHydrateSyncedPrefs(user({ frontend_settings: { cria: { colorScheme: 'dark' } } }));
    expect(useSettings.getState().colorScheme).toBe('dark');
    maybeHydrateSyncedPrefs(user({ frontend_settings: { cria: { colorScheme: 'light' } } }));
    expect(useSettings.getState().colorScheme).toBe('dark');
  });
});

// Vikunja-web stores the mode at frontend_settings.quick_add_magic_mode
// (snake_case on the wire); Cria shares that key rather than namespacing it.
describe('Quick Add Magic mode sync', () => {
  const withMode = (mode: unknown, extra: Record<string, unknown> = {}) =>
    user({ frontend_settings: { quick_add_magic_mode: mode, ...extra } });

  it('adopts the mode set on Vikunja-web', () => {
    maybeHydrateSyncedPrefs(withMode('todoist'));
    expect(useSettings.getState().quickAddMagicMode).toBe('todoist');
  });

  it('follows a later server-side change, after the once-per-session hydrate', () => {
    maybeHydrateSyncedPrefs(withMode('vikunja'));
    expect(globalThis.__cria_settingsHydrated__).toBe(true);
    maybeHydrateSyncedPrefs(withMode('disabled'));
    expect(useSettings.getState().quickAddMagicMode).toBe('disabled');
  });

  it('does not revert a local change while the server still holds the old mode', () => {
    maybeHydrateSyncedPrefs(withMode('vikunja'));
    useSettings.getState().setQuickAddMagicMode('todoist');
    maybeHydrateSyncedPrefs(withMode('vikunja'));
    expect(useSettings.getState().quickAddMagicMode).toBe('todoist');
  });

  it('ignores a missing or unknown server value', () => {
    useSettings.getState().setQuickAddMagicMode('todoist');
    maybeHydrateSyncedPrefs(user({}));
    maybeHydrateSyncedPrefs(withMode('emacs'));
    maybeHydrateSyncedPrefs(withMode(null));
    expect(useSettings.getState().quickAddMagicMode).toBe('todoist');
  });

  it('pushes the mode inside the full settings object, keeping other keys', async () => {
    getCachedUser.mockResolvedValue(user({
      name: 'Jake',
      default_project_id: 7,
      week_start: 0,
      language: 'de',
      frontend_settings: { quick_add_magic_mode: 'vikunja', color_schema: 'dark', otherClient: { x: 1 } },
    }));
    useSettings.getState().setQuickAddMagicMode('todoist');
    await pushSyncedPrefs();
    const body = pushUserSettings.mock.calls[0]![0];
    expect(body).toMatchObject({ name: 'Jake', default_project_id: 7, week_start: 0, language: 'de' });
    expect(body.frontend_settings).toMatchObject({
      quick_add_magic_mode: 'todoist',
      color_schema: 'dark',
      otherClient: { x: 1 },
    });
    expect(body.frontend_settings.cria).toBeDefined();
  });

  it('round-trips: a mode written by one session is read back by the next', () => {
    useSettings.getState().setQuickAddMagicMode('disabled');
    const sent = frontendSettingsWithCria({ color_schema: 'dark' });
    expect(sent).toMatchObject({ quick_add_magic_mode: 'disabled', color_schema: 'dark' });

    // A fresh session on another device, still on the default mode.
    globalThis.__cria_settingsHydrated__ = undefined;
    globalThis.__cria_serverQuickAddMode__ = undefined;
    useSettings.setState({ quickAddMagicMode: 'vikunja' });
    maybeHydrateSyncedPrefs(user({ frontend_settings: sent }));
    expect(useSettings.getState().quickAddMagicMode).toBe('disabled');
  });
});
