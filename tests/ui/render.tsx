// Rendering + seeding helpers for UI smoke tests. Import `./mocks` first.

import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { initSchema, clearTables } from '../unit/_helpers';
import { useAuth } from '@/auth/store';
import { useUi } from '@/stores/ui';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

export function renderWithProviders(ui: ReactElement) {
  const queryClient = makeQueryClient();
  const result = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { ...result, queryClient };
}

/** Put the auth store into an authenticated state without touching the keychain. */
export function signIn(): void {
  useAuth.setState({
    status: {
      kind: 'authenticated',
      credentials: {
        serverUrl: 'https://vikunja.test',
        token: 'test-token',
        authMethod: 'token',
      },
    },
  });
}

/** Fresh schema + empty tables + reset UI store. */
export async function resetDb(): Promise<void> {
  await initSchema();
  await clearTables();
  useUi.setState({ activeView: { kind: 'today' }, selectedTaskLocalId: null });
}
