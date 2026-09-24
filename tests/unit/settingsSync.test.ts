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

import { pushSyncedPrefs, maybeHydrateSyncedPrefs } from '@/sync/settingsSync';
import { useSettings } from '@/stores/settings';

const user = (settings: Record<string, unknown>) => ({ raw: { settings } }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__cria_settingsHydrated__ = undefined;
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
