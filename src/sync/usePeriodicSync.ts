import { useEffect } from 'react';
import { useAuth } from '@/auth/store';
import { throttledWarn } from '@/api/resilience';
import { pullProjects, pullLabels, pullAllTasks, pullAllViews, pullAllBuckets } from './pull';
import { reconcileDeletions } from './reconcile';
import { startOutboxSync, drainOutbox } from './push';
import { notify } from '@/db/bus';

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

    const stopOutbox = startOutboxSync();
    // One-shot drain on mount so any rows left over from a prior session
    // (or a crashed pre-fix drain) get pushed immediately, not on the next
    // user mutation.
    void drainOutbox().catch((err) =>
      console.warn('[periodic-sync] initial drain failed:', err),
    );

    let cancelled = false;
    const tick = async () => {
      // Drain the outbox before pulling so the circuit breaker is clean,
      // and so a row that failed its push (e.g. server was down) gets a
      // retry even without a new user mutation to trigger notify('outbox').
      try {
        await drainOutbox();
      } catch (err) {
        console.warn('[periodic-sync] outbox drain failed:', err);
      }
      try {
        await pullProjects();
        notify('projects');
      } catch (err) {
        throttledWarn('periodic-sync/projects', '[periodic-sync] project pull failed:', err);
      }
      try {
        await pullLabels();
        notify('labels');
      } catch (err) {
        throttledWarn('periodic-sync/labels', '[periodic-sync] label pull failed:', err);
      }
      try {
        // Pull every task (not just the open project) so the smart views
        // have cross-project data and project lists stay warm (#33).
        await pullAllTasks();
        notify('tasks');
      } catch (err) {
        throttledWarn('periodic-sync/all-tasks', '[periodic-sync] all-tasks pull failed:', err);
      }
      try {
        // Views + kanban buckets. Silent upserts, so notify('views')
        // afterwards to refresh any open ViewSwitcher / board.
        await pullAllViews();
        await pullAllBuckets();
        notify('views');
      } catch (err) {
        throttledWarn('periodic-sync/views', '[periodic-sync] views/buckets pull failed:', err);
      }
    };

    const id = setInterval(() => {
      if (!cancelled) void tick();
    }, INTERVAL_MS);

    // Deletion reconciliation every 15 min
    const RECONCILE_MS = 15 * 60 * 1000;
    const reconId = setInterval(() => {
      // reconcileDeletions throws (and aborts the delete sweep) on any HTTP
      // error or incomplete listing, so the call must not float uncaught.
      if (!cancelled)
        void reconcileDeletions().catch((err) =>
          throttledWarn(
            'periodic-sync/reconcile',
            '[periodic-sync] deletion reconcile failed:',
            err,
          ),
        );
    }, RECONCILE_MS);

    const onFocus = () => {
      if (!cancelled) void tick();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(reconId);
      window.removeEventListener('focus', onFocus);
      stopOutbox();
    };
  }, [isAuthed]);
}
