/**
 * Cross-stack "is this a network/offline failure?" check for arbitrary
 * thrown values. Used to surface a friendlier message instead of leaking
 * raw transport errors (URLs, opaque codes) to the user.
 *
 * Matches:
 *  - Tauri plugin-http (reqwest) — "error sending request for url …"
 *  - Browser fetch (Chromium) — "Failed to fetch"
 *  - WebKit fetch — "Load failed"
 *  - DOM TypeError NetworkError variants
 */
const OFFLINE_PATTERN = /error sending request|Failed to fetch|Load failed|NetworkError/i;

export function isOfflineError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return OFFLINE_PATTERN.test(msg);
}
