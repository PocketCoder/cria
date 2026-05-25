/**
 * In-process change bus. Repositories `notify(topic)` after a successful
 * write; query layers `subscribe(topic, …)` and invalidate the relevant
 * TanStack Query keys.
 *
 * Crude but effective. Replace if/when the Tauri SQL plugin gains LIVE
 * queries.
 */

export type Topic =
  | 'user'
  | 'tasks'
  | 'projects'
  | 'labels'
  | 'task_labels'
  | 'task_assignees'
  | 'outbox'
  | 'conflicts'
  | 'sync_state';

type Listener = () => void;

const listeners = new Map<Topic, Set<Listener>>();

export function subscribe(topic: Topic, fn: Listener): () => void {
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
  const set = listeners.get(topic);
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
  listeners.clear();
}
