/**
 * Native-platform detection seam.
 *
 * Used to gate *capabilities* (not layout): on iOS/Android there is no system
 * tray, global shortcut, launch-at-login, self-updater, or dock badge, so the
 * desktop-only wrappers in `src/tauri/*` and a few call sites no-op based on
 * this.
 *
 * `@tauri-apps/plugin-os`'s `platform()` is synchronous *inside* a Tauri
 * webview, but the plugin module isn't present in the browser-only Vite dev
 * server or the Node test runner — so we resolve it once at boot via a guarded
 * dynamic import and cache the result. `isMobilePlatform()` is a cheap sync
 * read everywhere else, defaulting to `false` (desktop/browser/tests) until
 * `initPlatform()` has run.
 *
 * For *layout* decisions (collapsing the three-pane shell), use
 * `useIsMobile()` instead — that keys off viewport width, not the OS.
 */

let mobile = false;

/**
 * Resolve the running platform once, early in startup (see `main.tsx`).
 * Safe to call outside Tauri — it swallows the failure and leaves the
 * platform as desktop (`false`).
 */
export async function initPlatform(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const { platform } = await import('@tauri-apps/plugin-os');
    const p = platform();
    mobile = p === 'ios' || p === 'android';
  } catch {
    mobile = false;
  }
}

/** True on iOS/Android. False on desktop, in the browser, and in tests. */
export function isMobilePlatform(): boolean {
  return mobile;
}
