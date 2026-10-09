import './mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from '@/components/SettingsModal';
import { useSettings } from '@/stores/settings';
import { renderWithProviders, resetDb, signIn } from './render';

// What the server holds when the modal opens. Every field must survive the
// full-object settings POST (AGENTS.md: omitted fields become Go zero values).
const INITIAL_SETTINGS = {
  name: 'Tester',
  language: 'de',
  timezone: 'Europe/London',
  week_start: 0,
  default_project_id: 7,
  email_reminders_enabled: true,
  overdue_tasks_reminders_enabled: true,
  overdue_tasks_reminders_time: '08:30',
  discoverable_by_email: true,
  discoverable_by_name: true,
  frontend_settings: {
    quick_add_magic_mode: 'todoist',
    color_schema: 'dark',
    play_sound_when_done: true,
  },
};

/**
 * A stand-in server: GET /user reads `server`, the settings POST replaces it.
 * Before Vikunja v2.7.0 there is no settings PATCH (404 here); with
 * `hasPatch` it merges the PATCH body into `server` (one level is enough for
 * these tests) and records it in `patched`.
 */
let server: Record<string, unknown>;
let posted: Array<Record<string, unknown>> = [];
let patched: Array<Record<string, unknown>> = [];
let postStatus = 200;
let hasPatch = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-pagination-total-pages': '1' },
  });
}

beforeEach(async () => {
  await resetDb();
  signIn();
  server = structuredClone(INITIAL_SETTINGS);
  posted = [];
  patched = [];
  postStatus = 200;
  hasPatch = false;
  globalThis.__cria_settingsHydrated__ = undefined;
  globalThis.__cria_serverQuickAddMode__ = undefined;
  globalThis.__cria_settingsSaveChain__ = undefined;
  globalThis.__cria_settingsPatchUnsupported__ = undefined;
  useSettings.setState({ quickAddMagicMode: 'vikunja' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      if (/\/api\/v1\/user$/.test(req.url)) {
        return json({ id: 1, username: 'tester', name: 'Tester', email: 'tester@example.test', settings: server });
      }
      if (req.url.includes('/api/v2/')) {
        if (!hasPatch || req.method !== 'PATCH') return json({ message: 'Not Found' }, 404);
        const patch = JSON.parse(await req.text()) as Record<string, unknown>;
        patched.push(patch);
        const frontend = patch.frontend_settings as Record<string, unknown> | undefined;
        server = {
          ...server,
          ...patch,
          frontend_settings: { ...(server.frontend_settings as Record<string, unknown>), ...frontend },
        };
        return json({ message: 'The settings were updated successfully.' });
      }
      if (req.method === 'POST' && req.url.endsWith('/user/settings/general')) {
        const body = JSON.parse(await req.text()) as Record<string, unknown>;
        posted.push(body);
        if (postStatus !== 200) return json({ message: 'Rejected' }, postStatus);
        server = body;
        return json({ message: 'The settings were updated successfully.' });
      }
      return json([]);
    }),
  );
});

async function openGeneralTab() {
  renderWithProviders(<SettingsModal onClose={() => undefined} initialTab="general" />);
  const trigger = await screen.findByRole('combobox', { name: 'Quick Add Magic' });
  await waitFor(() => expect(trigger).toHaveTextContent('Todoist'));
  return trigger;
}

async function chooseMode(trigger: HTMLElement, label: string) {
  const user = userEvent.setup();
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: label }));
}

describe('Settings → Quick Add Magic', () => {
  it('shows the web mode and writes a change back without wiping other settings', async () => {
    await chooseMode(await openGeneralTab(), 'Disabled');

    await waitFor(() => expect(posted).toHaveLength(1));
    const { frontend_settings: frontend, ...rest } = posted[0]!;
    const { frontend_settings: _initialFrontend, ...initialRest } = INITIAL_SETTINGS;
    expect(rest).toMatchObject(initialRest);
    expect(frontend).toEqual({ ...INITIAL_SETTINGS.frontend_settings, quick_add_magic_mode: 'disabled' });
    await waitFor(() => expect(useSettings.getState().quickAddMagicMode).toBe('disabled'));
  });

  it('builds the save on what the server holds now, not on what the modal loaded', async () => {
    const trigger = await openGeneralTab();
    // Meanwhile, on the web: other settings change.
    server = {
      ...server,
      week_start: 1,
      frontend_settings: { ...INITIAL_SETTINGS.frontend_settings, color_schema: 'light', sidebar_width: 400 },
    };

    await chooseMode(trigger, 'Vikunja');

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ week_start: 1, name: 'Tester' });
    expect(posted[0]!.frontend_settings).toEqual({
      quick_add_magic_mode: 'vikunja',
      color_schema: 'light',
      sidebar_width: 400,
      play_sound_when_done: true,
    });
  });

  it('sends only the mode as a merge-patch on a server with the v2 PATCH', async () => {
    hasPatch = true;
    const trigger = await openGeneralTab();
    // Meanwhile, on the web: other settings change.
    server = { ...server, week_start: 1, frontend_settings: { ...INITIAL_SETTINGS.frontend_settings, sidebar_width: 400 } };

    await chooseMode(trigger, 'Disabled');

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({ frontend_settings: { quick_add_magic_mode: 'disabled' } });
    expect(posted).toHaveLength(0);
    expect(server).toMatchObject({ week_start: 1, name: 'Tester', default_project_id: 7 });
    expect(server.frontend_settings).toEqual({
      ...INITIAL_SETTINGS.frontend_settings,
      sidebar_width: 400,
      quick_add_magic_mode: 'disabled',
    });
  });

  it('puts the previous mode back when the server rejects the change', async () => {
    postStatus = 400;
    await chooseMode(await openGeneralTab(), 'Vikunja');

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.frontend_settings).toMatchObject({ quick_add_magic_mode: 'vikunja' });
    await waitFor(() => expect(useSettings.getState().quickAddMagicMode).toBe('todoist'));
  });
});
