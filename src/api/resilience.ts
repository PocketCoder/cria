/**
 * Sync resilience helpers: a shared circuit breaker, a per-request timeout,
 * and throttled logging.
 *
 * Without these, a slow or unreachable server (e.g. a Cloudflare 524 that
 * hangs ~100s before failing) makes the app hang on every request, keep
 * hammering the origin, and flood the console with thousands of identical
 * warnings. The breaker trips after a few consecutive failures and fails
 * fast for a cooldown; the timeout caps how long any single request can
 * hang; throttledWarn collapses repeats.
 *
 * State is pinned on globalThis so a Vite HMR reload doesn't reset an open
 * circuit or the log-throttle bookkeeping (same pattern as src/db/bus.ts).
 */

/** Hard cap on how long a single request may run before we give up. */
export const REQUEST_TIMEOUT_MS = 20_000;
/** Consecutive server-health failures before the circuit opens. */
const FAILURE_THRESHOLD = 4;
/** How long the circuit stays open (fail-fast) before probing again. */
const COOLDOWN_MS = 30_000;
/** Minimum gap between identical throttled warnings. */
const LOG_THROTTLE_MS = 30_000;

interface ResilienceState {
  consecutiveFailures: number;
  /** Epoch ms until which the circuit is open; 0 when closed. */
  openUntil: number;
  lastLoggedAt: Map<string, number>;
  suppressed: Map<string, number>;
}

declare global {
  // eslint-disable-next-line no-var
  var __cria_resilience__: ResilienceState | undefined;
}

function state(): ResilienceState {
  return (globalThis.__cria_resilience__ ??= {
    consecutiveFailures: 0,
    openUntil: 0,
    lastLoggedAt: new Map(),
    suppressed: new Map(),
  });
}

/** Whether a network request may be attempted right now. */
export function canAttemptRequest(): boolean {
  return Date.now() >= state().openUntil;
}

/** Milliseconds until the circuit closes again (0 if already closed). */
export function circuitCooldownRemaining(): number {
  return Math.max(0, state().openUntil - Date.now());
}

/** Record a healthy response — closes the circuit. */
export function recordRequestSuccess(): void {
  const s = state();
  s.consecutiveFailures = 0;
  s.openUntil = 0;
}

/**
 * Record a server-health failure (timeout, network error, or 5xx). Once they
 * pile up past the threshold, the circuit opens for a cooldown.
 */
export function recordRequestFailure(): void {
  const s = state();
  s.consecutiveFailures += 1;
  if (s.consecutiveFailures >= FAILURE_THRESHOLD) {
    s.openUntil = Date.now() + COOLDOWN_MS;
  }
}

/** Test-only: reset breaker + throttle bookkeeping. */
export function _resetResilience(): void {
  globalThis.__cria_resilience__ = undefined;
}

/**
 * Reject `p` if it hasn't settled within `ms`. The caller is responsible for
 * aborting the underlying request (we also wire an AbortSignal in
 * platformFetch); this guarantees the promise settles even if the transport
 * ignores the signal.
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Request timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * console.warn that collapses repeats: emits at most once per LOG_THROTTLE_MS
 * per `key`, and reports how many repeats were suppressed since the last
 * emission. Use a stable `key` per call site (e.g. 'queries/user').
 */
export function throttledWarn(key: string, ...args: unknown[]): void {
  const s = state();
  const now = Date.now();
  const last = s.lastLoggedAt.get(key) ?? 0;
  if (now - last < LOG_THROTTLE_MS) {
    s.suppressed.set(key, (s.suppressed.get(key) ?? 0) + 1);
    return;
  }
  const n = s.suppressed.get(key) ?? 0;
  s.lastLoggedAt.set(key, now);
  s.suppressed.set(key, 0);
  if (n > 0) {
    console.warn(...args, `(+${n} more in the last ${Math.round(LOG_THROTTLE_MS / 1000)}s)`);
  } else {
    console.warn(...args);
  }
}
