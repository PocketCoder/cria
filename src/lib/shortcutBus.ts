/**
 * Tiny pub-sub for shortcut actions, decoupling the Shell-level key matcher
 * from the components that own the handlers (task detail, task list). Same
 * shape as db/bus but keyed by shortcut action id.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export function onShortcut(action: string, fn: Listener): () => void {
  let set = listeners.get(action);
  if (!set) {
    set = new Set();
    listeners.set(action, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

/** Returns true if at least one listener handled the action. */
export function emitShortcut(action: string): boolean {
  const set = listeners.get(action);
  if (!set || set.size === 0) return false;
  for (const fn of [...set]) {
    try {
      fn();
    } catch (err) {
      console.error(`[shortcuts] listener for "${action}" threw:`, err);
    }
  }
  return true;
}
