/**
 * In-process change bus. Repositories `notify(topic)` after a successful
 * write; query layers `subscribe(topic, …)` and invalidate the relevant
 * TanStack Query keys.
 *
 * Crude but effective. Replace if/when the Tauri SQL plugin gains LIVE
 * queries.
 *
 * **HMR-safe.** The listeners map is pinned on `globalThis` so a Vite
 * module reload of `bus.ts` doesn't reset it to empty while components
 * still hold references to the old `subscribe` closure (or vice versa).
 * Without this, mutations from the post-HMR code path silently dropped
 * notifications and the UI stopped refreshing after writes.
 */

export type Topic =
  | 'user'
  | 'tasks'
  | 'projects'
  | 'views'
  | 'buckets'
  | 'labels'
  | 'task_labels'
  | 'task_assignees'
  | 'outbox'
  | 'conflicts'
  | 'sync_state';

type Listener = () => void;

declare global {
  // eslint-disable-next-line no-var
  var __cria_busListeners__: Map<Topic, Set<Listener>> | undefined;
}

function getListeners(): Map<Topic, Set<Listener>> {
  return (globalThis.__cria_busListeners__ ??= new Map());
}

export function subscribe(topic: Topic, fn: Listener): () => void {
  const listeners = getListeners();
  let set = listeners.get(topic);
  if (!set) {
    set = new Set();
    listeners.set(topic, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

export function notify(topic: Topic): void {
  const set = getListeners().get(topic);
  if (!set) return;
  // Snapshot first — listeners may unsubscribe during fan-out.
  for (const fn of [...set]) {
    try {
      fn();
    } catch (err) {
      console.error(`[db/bus] listener for "${topic}" threw:`, err);
    }
  }
}

/** Used by tests to start fresh. */
export function _clearAllListeners(): void {
  getListeners().clear();
}
