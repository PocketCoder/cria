import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/globals.css';
import { App } from './App';

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
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
