/**
 * Page-visibility helpers for pausing background work on mobile.
 *
 * On iOS, JavaScript `setInterval` timers keep firing while the app is
 * backgrounded — a real battery and cellular-data drain (every periodic sync
 * pull, every reminder scan). The browser/desktop don't have the same cost
 * profile, so callers gate this on `isMobilePlatform()` and use these helpers
 * to suspend their timers while `document.visibilityState === 'hidden'`,
 * resuming (and optionally catching up) when the app returns to foreground.
 *
 * TanStack Query's own `refetchInterval` already pauses in the background by
 * default (`refetchIntervalInBackground: false`), so these are only needed for
 * the hand-rolled `setInterval` loops in src/sync/*.
 */

/** True while the document is foreground-visible (or off-DOM, e.g. tests). */
export function isPageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * Subscribe to foreground/background transitions. Calls `onShow` when the page
 * becomes visible and `onHide` when it goes to the background. Returns an
 * unsubscribe function. No-ops (and returns a no-op cleanup) off-DOM.
 */
export function onVisibilityChange(handlers: {
  onShow?: () => void;
  onHide?: () => void;
}): () => void {
  if (typeof document === 'undefined') return () => {};
  const listener = () => {
    if (isPageVisible()) handlers.onShow?.();
    else handlers.onHide?.();
  };
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}
