/**
 * Vitest setup — runs before each test file (both `node` and `jsdom`
 * environments).
 *
 * jsdom (as resolved in this repo) instantiates `window` but does NOT expose
 * `window.localStorage`. zustand's `persist` middleware defaults its storage to
 * `createJSONStorage(() => window.localStorage)` and calls `storage.setItem`
 * synchronously on every `setState`, so a missing `localStorage` makes any
 * persisted-store test throw "Cannot read properties of undefined (reading
 * 'setItem')". The real app always runs in a webview where `localStorage`
 * exists, so this is purely a test-environment gap — we fill it with a tiny
 * in-memory implementation. Guarded so the `node`-environment tests (no
 * `window`) are unaffected.
 */

class MemoryStorage implements Storage {
  #store = new Map<string, string>();
  get length(): number {
    return this.#store.size;
  }
  clear(): void {
    this.#store.clear();
  }
  getItem(key: string): string | null {
    return this.#store.has(key) ? this.#store.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.#store.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.#store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.#store.set(key, String(value));
  }
}

if (typeof window !== 'undefined' && !window.localStorage) {
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
