// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getCachedUser, pushUserSettings, patchUserSettings, fetchCurrentUser } = vi.hoisted(() => ({
  getCachedUser: vi.fn(),
  pushUserSettings: vi.fn(),
  patchUserSettings: vi.fn(),
  fetchCurrentUser: vi.fn(),
}));
vi.mock('@/db/user', () => ({ getCachedUser }));
vi.mock('@/api/user', () => ({ fetchCurrentUser }));
vi.mock('@/api/userSettings', async (orig) => ({
  ...(await orig<typeof import('@/api/userSettings')>()),
  pushUserSettings,
  patchUserSettings,
}));

import {
  pushSyncedPrefs,
  maybeHydrateSyncedPrefs,
  saveUserSettings,
  startSettingsSync,
} from '@/sync/settingsSync';
import { useSettings } from '@/stores/settings';

const user = (settings: Record<string, unknown>) => ({ raw: { settings } }) as never;

/**
 * A stand-in Vikunja server from before v2.7.0, so every save takes the v1
 * path: no settings PATCH, GET /user returns a copy of `server`, and the
 * settings POST replaces it wholesale, as the real handler does. The v2 path
 * is covered against a fuller fake server in settingsPatch.test.ts.
 */
let server: Record<string, unknown>;
const serverFrontend = () => server.frontend_settings as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__cria_settingsHydrated__ = undefined;
  globalThis.__cria_serverQuickAddMode__ = undefined;
  globalThis.__cria_settingsSaveChain__ = undefined;
  globalThis.__cria_settingsPatchUnsupported__ = undefined;
  patchUserSettings.mockResolvedValue('unsupported');
  useSettings.setState({ quickAddMagicMode: 'vikunja', colorScheme: 'system', dateFormat: 'YYYY-MM-DD' });
  server = {
    name: 'Jake',
    default_project_id: 7,
    week_start: 1,
    language: 'de',
    overdue_tasks_reminders_time: '08:30',
    frontend_settings: { quick_add_magic_mode: 'vikunja', color_schema: 'dark', otherClient: { x: 1 } },
  };
  getCachedUser.mockImplementation(async () => user(structuredClone(server)));
  fetchCurrentUser.mockImplementation(async () => user(structuredClone(server)));
  pushUserSettings.mockImplementation(async (body: Record<string, unknown>) => {
    server = structuredClone(body);
  });
});

describe('pushSyncedPrefs', () => {
  // The settings POST is a full-object replace (AGENTS.md): every server
  // field must round-trip or the server writes Go zero values over it.
  it('sends the full server settings with only frontend_settings.cria changed', async () => {
    useSettings.getState().setColorScheme('dark');
    await pushSyncedPrefs();
    const body = pushUserSettings.mock.calls[0]![0];
    expect(body).toMatchObject({ name: 'Jake', default_project_id: 7, week_start: 1, language: 'de' });
    expect(body.frontend_settings.otherClient).toEqual({ x: 1 });
    expect(body.frontend_settings.color_schema).toBe('dark');
    expect(body.frontend_settings.cria.colorScheme).toBe('dark');
  });

  it('does nothing when no user is cached', async () => {
    getCachedUser.mockResolvedValue(null);
    await pushSyncedPrefs();
    expect(fetchCurrentUser).not.toHaveBeenCalled();
    expect(pushUserSettings).not.toHaveBeenCalled();
  });

  it("sends only the named prefs, keeping another device's change to a different one", async () => {
    serverFrontend().cria = { dateFormat: 'DD/MM/YYYY', colorScheme: 'light' };
    useSettings.getState().setColorScheme('dark');
    await pushSyncedPrefs(['colorScheme']);
    expect(serverFrontend().cria).toEqual({ dateFormat: 'DD/MM/YYYY', colorScheme: 'dark' });
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

  it('writes a mode change at web\'s key, keeping every other field and key', async () => {
    useSettings.getState().setQuickAddMagicMode('disabled');
    await saveUserSettings({ frontend: { quick_add_magic_mode: 'disabled' } });
    expect(server).toMatchObject({ name: 'Jake', default_project_id: 7, week_start: 1, language: 'de' });
    expect(serverFrontend()).toEqual({ quick_add_magic_mode: 'disabled', color_schema: 'dark', otherClient: { x: 1 } });
    // The next refetch shows the mode we wrote: nothing to follow.
    maybeHydrateSyncedPrefs(user(structuredClone(server)));
    expect(useSettings.getState().quickAddMagicMode).toBe('disabled');
  });
});

describe('saveUserSettings', () => {
  it('never writes back a stale mode: a web change survives a Cria save of something else', async () => {
    // Cria loaded the user while the server had `vikunja`.
    maybeHydrateSyncedPrefs(user(structuredClone(server)));
    // Then, on the web: Todoist mode plus a key Cria has never heard of.
    serverFrontend().quick_add_magic_mode = 'todoist';
    serverFrontend().sidebar_width = 400;
    server.week_start = 0;

    // Cria saves an unrelated setting with its now-stale cache.
    useSettings.getState().setColorScheme('dark');
    await pushSyncedPrefs(['colorScheme']);

    expect(serverFrontend()).toMatchObject({ quick_add_magic_mode: 'todoist', sidebar_width: 400 });
    expect(server.week_start).toBe(0);
    // And the app switches to the web's mode at the same time.
    expect(useSettings.getState().quickAddMagicMode).toBe('todoist');
  });

  it('keeps a web change to a top-level field when Cria changes another', async () => {
    server.language = 'fr';
    await saveUserSettings({ settings: { name: 'Jacob' } });
    expect(server).toMatchObject({ name: 'Jacob', language: 'fr' });
  });

  it('runs saves one at a time, each on top of the last', async () => {
    let releaseFirstGet!: () => void;
    const firstGet = new Promise<void>((r) => (releaseFirstGet = r));
    fetchCurrentUser.mockImplementationOnce(async () => {
      await firstGet;
      return user(structuredClone(server));
    });

    const a = saveUserSettings({ settings: { name: 'A' } });
    const b = saveUserSettings({ settings: { week_start: 3 } });
    await vi.waitFor(() => expect(fetchCurrentUser).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchCurrentUser).toHaveBeenCalledTimes(1); // b waits for a
    releaseFirstGet();
    await Promise.all([a, b]);

    expect(pushUserSettings).toHaveBeenCalledTimes(2);
    expect(server).toMatchObject({ name: 'A', week_start: 3 });
  });

  it('sends nothing when the fresh read fails, and later saves still run', async () => {
    fetchCurrentUser.mockRejectedValueOnce(new Error('offline'));
    await expect(saveUserSettings({ settings: { name: 'X' } })).rejects.toThrow('offline');
    expect(pushUserSettings).not.toHaveBeenCalled();

    await saveUserSettings({ settings: { name: 'Y' } });
    expect(server.name).toBe('Y');
  });
});

describe('startSettingsSync', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces and pushes only the prefs that changed', async () => {
    vi.useFakeTimers();
    serverFrontend().cria = { dateFormat: 'DD/MM/YYYY' };
    const stop = startSettingsSync();
    useSettings.getState().setColorScheme('dark');
    useSettings.getState().setQuickAddMagicMode('todoist'); // not a Cria pref: saved by its own control
    await vi.advanceTimersByTimeAsync(800);
    stop();

    expect(pushUserSettings).toHaveBeenCalledTimes(1);
    expect(serverFrontend().cria).toEqual({ dateFormat: 'DD/MM/YYYY', colorScheme: 'dark' });
    expect(serverFrontend().quick_add_magic_mode).toBe('vikunja');
  });
});
