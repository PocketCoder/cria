import './mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { SettingsModal } from '@/components/SettingsModal';
import { Toasts } from '@/components/Toasts';
import { useSettings } from '@/stores/settings';
import { useToasts } from '@/stores/toasts';
import { makeQueryClient, resetDb, signIn } from './render';

let server: Record<string, unknown>;
let posted: Array<Record<string, unknown>> = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-pagination-total-pages': '1' },
  });

beforeEach(async () => {
  await resetDb();
  signIn();
  server = {
    name: 'Tester',
    language: 'en',
    timezone: 'UTC',
    week_start: 1,
    email_reminders_enabled: true,
    overdue_tasks_reminders_enabled: true,
    overdue_tasks_reminders_time: '08:00',
    discoverable_by_email: false,
    discoverable_by_name: false,
    frontend_settings: {},
  };
  posted = [];
  globalThis.__cria_settingsHydrated__ = undefined;
  globalThis.__cria_serverQuickAddMode__ = undefined;
  globalThis.__cria_settingsSaveChain__ = undefined;
  globalThis.__cria_settingsPatchUnsupported__ = undefined;
  useSettings.setState({ quickAddMagicMode: 'vikunja' });
  useToasts.setState({ toasts: [] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      if (/\/api\/v1\/user$/.test(req.url)) {
        return json({ id: 1, username: 'tester', name: 'Tester', email: 't@example.test', settings: server });
      }
      if (req.url.includes('/api/v2/')) return json({ message: 'Not Found' }, 404);
      if (req.method === 'POST' && req.url.endsWith('/user/settings/general')) {
        const body = JSON.parse(await req.text()) as Record<string, unknown>;
        posted.push(body);
        server = body;
        return json({ message: 'ok' });
      }
      return json([]);
    }),
  );
});

function row(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

describe('Settings → General persistence', () => {
  it('keeps a switch after leaving the tab and coming back, and confirms with a toast', async () => {
    // One query cache across both visits, as in the app (the user query stays fresh for 60s).
    const qc = makeQueryClient();
    const ui = (
      <QueryClientProvider client={qc}>
        <SettingsModal onClose={() => undefined} initialTab="general" />
        <Toasts />
      </QueryClientProvider>
    );

    const first = render(ui);
    await waitFor(() => expect(within(row('Email reminders')).getByRole('switch')).toBeChecked());
    await userEvent.setup().click(within(row('Email reminders')).getByRole('switch'));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ email_reminders_enabled: false, name: 'Tester' });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    // The confirmation floats: nothing was added to the page's own flow.
    expect(screen.getByRole('status')).toHaveClass('fixed');

    first.unmount();
    render(ui);
    await waitFor(() => expect(within(row('Email reminders')).getByRole('switch')).not.toBeChecked());
  });

  it('shows a switched-on value from the server, not just switched-off ones', async () => {
    server = { ...server, discoverable_by_email: true };
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <SettingsModal onClose={() => undefined} initialTab="general" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(within(row('Discoverable by email')).getByRole('switch')).toBeChecked());
  });
});
