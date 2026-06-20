import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/globals.css';
import { App } from './App';
import { initPlatform, isMobilePlatform } from './lib/platform';

// `networkMode: 'offlineFirst'` is load-bearing. The default
// (`'online'`) tells TanStack Query to *pause* every query when
// `navigator.onLine === false` — the queryFn never runs, `data`
// stays undefined, and the task list renders empty even though the
// rows are sitting in SQLite. Cria is offline-first by design: our
// queryFns already catch the pull error and fall through to a pure
// DB read (see src/queries/tasks.ts and friends), so we want them
// to RUN regardless of online state. Mutations use the same setting
// so local creates/edits aren't silently swallowed while offline —
// the outbox absorbs them and drains when the network is back.
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

// Resolve the native platform (iOS/Android vs desktop) before first render so
// the desktop-only wrappers and call sites gate correctly from the start.
// Defaults to desktop and never rejects, so render always proceeds.
//
// The QueryClient is built *inside* the callback so `isMobilePlatform()` reads
// the resolved value: on mobile we widen `staleTime` (background sync keeps
// data fresh, so foreground refetches are wasteful battery/network).
void initPlatform().finally(() => {
  const mobile = isMobilePlatform();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: mobile ? 60_000 : 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
        networkMode: 'offlineFirst',
      },
      mutations: {
        networkMode: 'offlineFirst',
      },
    },
  });

  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
});
