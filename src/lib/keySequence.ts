/**
 * Pure key-sequence matcher for the fixed Vikunja shortcut set: single keys
 * ('t'), modifier combos ('mod+k'), and "then" sequences ('g' then 'o',
 * '.' '.' '.'). Time is injected so tests never touch real clocks; the
 * caller drives `tick()` (Shell uses a setTimeout) to resolve a match that
 * is also the prefix of a longer binding — '.' must wait for a possible
 * second '.' before firing.
 */

export interface KeyBinding {
  id: string;
  /** Normalized keys (see eventToKey), in press order. */
  keys: string[];
}

export interface FeedResult {
  /** Binding ids fired by this key press, in firing order. */
  fired: string[];
  /** True when the buffer is a live prefix awaiting more keys. */
  pending: boolean;
}

interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_KEYS = new Set(['shift', 'meta', 'control', 'alt']);

/**
 * Normalize a keyboard event to a binding key: 'mod+k', 'shift+r', 'g',
 * 'arrowleft', 'backspace', '.'. Meta and Ctrl both map to 'mod' (⌘ on
 * mac, Ctrl elsewhere). Bare modifier presses return null.
 */
export function eventToKey(e: KeyEventLike): string | null {
  const base = e.key.toLowerCase();
  if (MODIFIER_KEYS.has(base)) return null;
  const mods: string[] = [];
  if (e.metaKey || e.ctrlKey) mods.push('mod');
  if (e.altKey) mods.push('alt');
  // Shift is significant only alongside another modifier or for letters —
  // punctuation that needs shift ('.', '?') already arrives as itself.
  if (e.shiftKey && /^[a-z]$/.test(base)) mods.push('shift');
  return [...mods, base].join('+');
}

export function createKeyMatcher(bindings: KeyBinding[], timeoutMs: number) {
  let buffer: string[] = [];
  let lastAt = -Infinity;
  /** Exact match waiting out longer candidates (e.g. '.' vs '..'). */
  let deferred: { id: string; at: number } | null = null;

  const candidatesFor = (keys: string[]) =>
    bindings.filter(
      (b) =>
        b.keys.length >= keys.length &&
        keys.every((k, i) => b.keys[i] === k),
    );

  const reset = () => {
    buffer = [];
    deferred = null;
  };

  function feed(key: string, now: number): FeedResult {
    const fired: string[] = [];

    if (now - lastAt > timeoutMs && buffer.length > 0) {
      // Sequence expired. A deferred exact match should still fire late —
      // tick() normally handles this, but be robust without it.
      if (deferred) fired.push(deferred.id);
      reset();
    }
    lastAt = now;

    buffer.push(key);
    let candidates = candidatesFor(buffer);

    if (candidates.length === 0) {
      // Key can't continue the sequence: resolve any deferred match first,
      // then retry this key as the start of a fresh sequence.
      if (deferred) fired.push(deferred.id);
      reset();
      buffer = [key];
      candidates = candidatesFor(buffer);
      if (candidates.length === 0) {
        reset();
        return { fired, pending: false };
      }
    }

    const exact = candidates.find((b) => b.keys.length === buffer.length);
    const longer = candidates.some((b) => b.keys.length > buffer.length);

    if (exact && !longer) {
      fired.push(exact.id);
      reset();
      return { fired, pending: false };
    }
    if (exact) {
      // Also a prefix of something longer — wait for the next key or tick.
      deferred = { id: exact.id, at: now };
      return { fired, pending: true };
    }
    return { fired, pending: true };
  }

  /** Resolve a deferred match once its wait window has elapsed. */
  function tick(now: number): string | null {
    if (deferred && now - deferred.at > timeoutMs) {
      const id = deferred.id;
      reset();
      return id;
    }
    return null;
  }

  return { feed, tick };
}
