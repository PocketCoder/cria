import { useEffect } from 'react';
import { useAuth } from '@/auth/store';
import { throttledWarn } from '@/api/resilience';
import { pullProjects, pullSavedFilters, pullLabels, pullAllTasks, pullAllViews, pullAllBuckets } from './pull';
import { reconcileDeletions } from './reconcile';
import { startOutboxSync, drainOutbox } from './push';
import { notify } from '@/db/bus';
import { isMobilePlatform } from '@/lib/platform';
import { isPageVisible, onVisibilityChange } from '@/lib/visibility';

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
        // Saved-filter details for pseudo-projects pulled just above.
        await pullSavedFilters();
      } catch (err) {
        throttledWarn('periodic-sync/saved-filters', '[periodic-sync] saved-filter pull failed:', err);
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

    // On mobile, skip ticks while backgrounded — iOS keeps JS timers running,
    // so an un-gated pull would burn battery/cellular every 60s in the
    // background. Desktop ticks unconditionally (cheap, and a tray window is
    // "hidden" by design). Foreground resume is wired via onVisibilityChange.
    const shouldTick = () => !cancelled && (!isMobilePlatform() || isPageVisible());

    // Run one sync immediately on mount instead of waiting a full INTERVAL_MS
    // for the first tick. The on-mount query hooks only pull projects, labels,
    // and the *currently open* project (useProjectTasks) — nothing pulls
    // pullAllTasks on mount, so without this the cross-project data behind the
    // smart views (Inbox/Today/Upcoming) and every not-yet-opened project stays
    // empty for up to 60s after launch. Pulls are singleFlight-deduped, so this
    // won't double-fetch alongside those hooks.
    if (shouldTick()) void tick();

    const id = setInterval(() => {
      if (shouldTick()) void tick();
    }, INTERVAL_MS);

    // Deletion reconciliation every 15 min
    const RECONCILE_MS = 15 * 60 * 1000;
    const reconId = setInterval(() => {
      // reconcileDeletions throws (and aborts the delete sweep) on any HTTP
      // error or incomplete listing, so the call must not float uncaught.
      if (shouldTick())
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
    // Mobile foreground signal (window 'focus' is unreliable on iOS): pull
    // immediately when the app returns from the background so the user sees
    // fresh data without waiting up to 60s for the next tick.
    const stopVisibility = isMobilePlatform()
      ? onVisibilityChange({ onShow: () => { if (!cancelled) void tick(); } })
      : () => {};

    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(reconId);
      window.removeEventListener('focus', onFocus);
      stopVisibility();
      stopOutbox();
    };
  }, [isAuthed]);
}
