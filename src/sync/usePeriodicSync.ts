import { useEffect } from 'react';
import { useAuth } from '@/auth/store';
import { pullProjects } from './pull';

const INTERVAL_MS = 60_000;

/**
 * Lightweight periodic pull while authenticated. Per SPEC §7.6 the
 * "light pull" cadence is 60s; M1 only refreshes the project list (tasks
 * refresh whenever the user switches projects). M2+ will fold in tasks
 * via /tasks delta filters and the outbox push loop.
 *
 * One global timer — mount this hook once in the App.
 */
export function usePeriodicSync() {
  const isAuthed = useAuth((s) => s.status.kind === 'authenticated');

  useEffect(() => {
    if (!isAuthed) return;

    let cancelled = false;
    const tick = async () => {
      try {
        await pullProjects();
      } catch (err) {
        console.warn('[periodic-sync] pull failed:', err);
      }
    };

    const id = setInterval(() => {
      if (!cancelled) void tick();
    }, INTERVAL_MS);

    const onFocus = () => {
      if (!cancelled) void tick();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [isAuthed]);
}
