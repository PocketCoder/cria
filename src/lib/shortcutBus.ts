/**
 * Tiny pub-sub for shortcut actions, decoupling the Shell-level key matcher
 * from the components that own the handlers (task detail, task list). Same
 * shape as db/bus.ts but keyed by shortcut action id.
 *
 * **HMR-safe.** The listeners map is pinned on `globalThis`, mirroring
 * db/bus.ts — otherwise a Vite module reload of this file resets it to
 * empty while `useShortcuts` (mounted once at the Shell root, rarely
 * touched) still holds a closure over the old module instance. Every
 * `emitShortcut` call would then write to a map no live `onShortcut`
 * subscriber is reading from — every task-detail/list shortcut silently
 * doing nothing, which is exactly the failure this caused before the fix.
 */

type Listener = () => void;

declare global {
  // eslint-disable-next-line no-var
  var __cria_shortcutListeners__: Map<string, Set<Listener>> | undefined;
}

function getListeners(): Map<string, Set<Listener>> {
  return (globalThis.__cria_shortcutListeners__ ??= new Map());
}

export function onShortcut(action: string, fn: Listener): () => void {
  const listeners = getListeners();
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
  const set = getListeners().get(action);
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
