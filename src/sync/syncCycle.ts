import { throttledWarn } from '@/api/resilience';
import { pullProjects, pullSavedFilters, pullLabels, pullAllTasks, pullAllViews, pullAllBuckets } from './pull';
import { drainOutbox } from './push';
import { notify } from '@/db/bus';

let lastFinishedAt = 0;

/** When the last sync cycle finished (ms since epoch), or 0 if none has. */
export function lastSyncCycleAt(): number {
  return lastFinishedAt;
}

/**
 * One full sync cycle: drain the outbox, then pull projects, saved filters,
 * labels, all tasks (delta-filtered), views and buckets. Each pull is
 * followed by one notify() for its topic. Every step reports its own failure
 * and the cycle carries on, so a flaky endpoint never starves the others.
 *
 * Shared by the 60s timer, the focus/foreground triggers and live sync. The
 * pulls are singleFlight-deduped, so overlapping callers don't double-fetch.
 */
export async function runSyncCycle(): Promise<void> {
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
    notify('saved_filters');
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
  lastFinishedAt = Date.now();
}
