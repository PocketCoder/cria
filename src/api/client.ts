import createClient, { type Client } from 'openapi-fetch';
import type { paths } from './schema';
import { buildApiError, NetworkError } from './errors';
import {
  REQUEST_TIMEOUT_MS,
  canAttemptRequest,
  circuitCooldownRemaining,
  recordRequestFailure,
  recordRequestSuccess,
  withTimeout,
} from './resilience';
import { getAuthSnapshot, useAuth } from '@/auth/store';

export type ApiClient = Client<paths>;

/**
 * The server rejected our token. For password sessions this is usually just the
 * short-lived JWT expiring (Vikunja's `service.jwtttlshort` is 10min by
 * default), so before counting a 401 as fatal `platformFetch` first tries to
 * refresh the JWT from the stored refresh token and retry the request once (see
 * refreshSession). A 401 only reaches `handleUnauthorized` when there's nothing
 * to refresh (API-token logins) or the refresh itself failed.
 *
 * Even then a *single* 401 is often transient — a request resumed after the app
 * was backgrounded with a momentarily-stale token, a proxy/server hiccup, a
 * clock-skew JWT rejection, or a race where the token wasn't attached yet.
 * Signing out on the first one nukes the whole session and forces a re-login
 * ("logged out after a short while"). So we only sign out after several
 * *consecutive* 401s with no successful response in between: a genuinely
 * expired/revoked token keeps 401ing — the 60s sync alone hits several
 * endpoints — so real revocation still signs out within a tick or two, while a
 * stray 401 is shrugged off and the next success resets the count.
 */
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;
let consecutiveAuthFailures = 0;

/** Any successful response proves the current token still works — reset. */
function noteRequestAuthorized(): void {
  consecutiveAuthFailures = 0;
}

function handleUnauthorized(): void {
  // A stray 401 during the login handshake itself can't trigger a sign-out.
  if (useAuth.getState().status.kind !== 'authenticated') return;
  consecutiveAuthFailures += 1;
  if (consecutiveAuthFailures >= MAX_CONSECUTIVE_AUTH_FAILURES) {
    consecutiveAuthFailures = 0;
    void useAuth.getState().signOut();
  }
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Fetch wrapper that routes through Tauri's HTTP plugin when we're
 * running inside the Tauri webview, falling back to `globalThis.fetch`
 * otherwise.
 *
 * Why: in production the webview loads from `tauri://localhost`, so
 * direct calls to a remote Vikunja host trip the browser's CORS checks
 * (the server has no reason to whitelist a custom-protocol origin).
 * Tauri's HTTP plugin issues the request from the Rust side, which has
 * no CORS enforcement; the response comes back through the IPC bridge.
 *
 * Detection: `window.__TAURI_INTERNALS__` is set by Tauri's bootstrap
 * before any app code runs. In vitest there's no `window`; in
 * `pnpm vite` (browser-only dev) there's a window but no internals, so
 * we use native fetch and the Vite proxy / browser CORS rules apply.
 *
 * openapi-fetch passes a `Request` object as the single argument; Tauri
 * plugin-http accepts `URL | Request | string` so the pass-through is
 * type-safe.
 */
const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let cachedTauriFetch: typeof fetch | null = null;

/** Vikunja's refresh-token cookie name (see pkg/modules/auth/auth.go). */
const REFRESH_COOKIE = 'vikunja_refresh_token';

/**
 * Pull the refresh token out of a `Set-Cookie` response header. Works in the
 * Tauri webview because plugin-http exposes `set-cookie` to JS (a real browser
 * would hide it). Tolerant of a missing header so it's safe on any response.
 */
export function readRefreshCookie(headers: Headers | null | undefined): string | null {
  if (!headers) return null;
  const list: string[] =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie') as string]
        : [];
  for (const c of list) {
    const m = new RegExp(`(?:^|;\\s*)${REFRESH_COOKIE}=([^;]+)`).exec(c);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  return null;
}

/** The current password session's refresh token, or null for any other state
 *  (unauthenticated, or an API-token login that doesn't expire). */
function passwordRefreshToken(): string | null {
  const s = useAuth.getState().status;
  if (s.kind !== 'authenticated') return null;
  const c = s.credentials;
  return c.authMethod === 'password' && c.refreshToken ? c.refreshToken : null;
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchange the stored refresh token for a fresh JWT and persist it. Concurrent
 * callers (the sync hits several endpoints at once) share a single in-flight
 * request. Returns the new access token, or null if there's nothing to refresh
 * or the refresh failed (in which case the session is genuinely dead).
 */
export function refreshSession(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<string | null> {
  const s = useAuth.getState().status;
  if (s.kind !== 'authenticated') return null;
  const creds = s.credentials;
  if (creds.authMethod !== 'password' || !creds.refreshToken) return null;

  const base = `${normalizeBase(creds.serverUrl)}/api/v1`;
  let res: Response;
  try {
    // Don't leak the refresh token over plaintext (same rule as Bearer tokens).
    guardTokenDestination(base, creds.refreshToken);
    // The refresh token rides as a cookie (not a Bearer header); the server
    // rotates it and returns the new JWT in the body + a new cookie.
    res = await fetchOnce(`${base}/user/token/refresh`, {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=${creds.refreshToken}` },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let body: { token?: string } | null = null;
  try {
    body = (await res.json()) as { token?: string };
  } catch {
    return null;
  }
  if (!body?.token) return null;

  const rotated = readRefreshCookie(res.headers) ?? creds.refreshToken;
  await useAuth.getState().updateSession(body.token, rotated);
  return body.token;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return '';
}

function requestHasAuth(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (init?.headers && new Headers(init.headers).has('authorization')) return true;
  return input instanceof Request && input.headers.has('authorization');
}

function withAuthHeader(src: HeadersInit | undefined, token: string): Headers {
  const h = new Headers(src);
  h.set('Authorization', `Bearer ${token}`);
  return h;
}

/**
 * Public so other modules that bypass openapi-fetch (e.g. multipart
 * uploads and blob downloads in `sync/attachments.ts`) can share the
 * same CORS-dodge + import-once cache instead of reimplementing it.
 *
 * On a 401 from a password session it transparently refreshes the JWT and
 * retries the request once, so a routinely-expired access token never surfaces
 * to callers (or trips the sign-out counter).
 */
export async function platformFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Eligible to refresh-and-retry only when this is an authenticated password
  // request (not the refresh call itself, and not an API-token / anonymous one).
  const eligible =
    passwordRefreshToken() !== null &&
    requestHasAuth(input, init) &&
    !requestUrl(input).includes('/user/token/refresh');
  // A Request body is single-use, so snapshot it before the first send in case
  // we need to replay with a fresh token.
  const retrySource = eligible && input instanceof Request ? input.clone() : null;

  const res = await fetchOnce(input, init);
  if (res.status !== 401 || !eligible) return res;

  const token = await refreshSession();
  if (!token) return res;

  if (retrySource) {
    return fetchOnce(
      new Request(retrySource, { headers: withAuthHeader(retrySource.headers, token) }),
    );
  }
  return fetchOnce(input, { ...init, headers: withAuthHeader(init?.headers, token) });
}

/** Raw, single-shot network call: circuit breaker + timeout + CORS-dodge. No
 *  auth-refresh logic (refreshSession calls this directly to avoid recursion). */
async function fetchOnce(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Fail fast while the circuit is open, instead of starting a request that
  // will only hang and time out.
  if (!canAttemptRequest()) {
    throw new NetworkError(
      `Server unavailable — backing off for ${Math.ceil(circuitCooldownRemaining() / 1000)}s`,
    );
  }

  // Bound every request: abort the underlying call and race a timeout so a
  // hung origin (e.g. a Cloudflare 524) fails in ~20s, not ~100s.
  const controller = new AbortController();
  // Forward the caller's signal — if they abort, we abort too.
  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener('abort', () => controller.abort(callerSignal.reason), { once: true });
    }
  }
  const signalledInit: RequestInit = { ...init, signal: controller.signal };
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    if (isTauri && !cachedTauriFetch) {
      const mod = await import('@tauri-apps/plugin-http');
      cachedTauriFetch = mod.fetch as typeof fetch;
    }
    const doFetch = isTauri
      ? cachedTauriFetch!(input, signalledInit)
      : globalThis.fetch(input, signalledInit);
    const response = await withTimeout(doFetch, REQUEST_TIMEOUT_MS);
    // A 5xx means the server is unhealthy; 2xx/4xx mean it's responding.
    if (response.status >= 500) recordRequestFailure();
    else recordRequestSuccess();
    // A 2xx proves the current token is still accepted — clears any transient
    // 401 streak so a single stray rejection can't accumulate into a sign-out.
    if (response.ok) noteRequestAuthorized();
    return response;
  } catch (err) {
    recordRequestFailure();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a Vikunja API client bound to the current auth snapshot.
 *
 * The snapshot is read each time the client is constructed; for long-running
 * sync work, call `createApiClient()` once per cycle so token rotation takes
 * effect on the next cycle without restarting the app.
 */
/** Refuse to send a Bearer token to a non-https, non-loopback origin. */
function guardTokenDestination(baseUrl: string, token: string): void {
  if (!token) return;
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== 'https:') {
      const loopbacks = ['localhost', '127.0.0.1', '[::1]'];
      if (!loopbacks.includes(u.hostname)) {
        throw new Error(
          `Refusing to send credentials to ${u.origin} — use https:// or a loopback address`,
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Refusing')) throw err;
  }
}

export function createApiClient(opts?: {
  baseUrl?: string;
  token?: string;
}): ApiClient {
  const snap = getAuthSnapshot();
  const baseUrl = `${normalizeBase(opts?.baseUrl ?? snap.serverUrl ?? '')}/api/v1`;
  const token = opts?.token ?? snap.token ?? '';

  guardTokenDestination(baseUrl, token);

  return createClient<paths>({
    baseUrl,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    fetch: platformFetch,
  });
}

/**
 * Build an authenticated `fetch`-like function bound to the current auth
 * context.  Use this for endpoints the generated OpenAPI types don't cover
 * (e.g. views/buckets pagination where `query` is typed `never`).
 */
export function createApiFetch(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const snap = getAuthSnapshot();
  const baseUrl = `${normalizeBase(snap.serverUrl ?? '')}/api/v1`;
  const token = snap.token ?? '';
  guardTokenDestination(baseUrl, token);
  return async (input, init) => {
    const url = typeof input === 'string' ? `${baseUrl}${input}` : input;
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}`, ...(init?.headers as Record<string, string> | undefined) }
      : { ...(init?.headers as Record<string, string> | undefined) };
    const res = await platformFetch(url, { ...init, headers });
    if (res.status === 401) handleUnauthorized();
    return res;
  };
}

/**
 * Like fetch, but unwraps openapi-fetch's `{ data, error, response }` envelope:
 * - 2xx with a body → returns parsed data
 * - 4xx/5xx → throws ApiError (with Vikunja's error envelope, if present)
 * - network failure → throws NetworkError
 */
export async function callApi<T>(
  promise: Promise<{
    data?: T;
    error?: unknown;
    response: Response;
  }>,
): Promise<T> {
  let result;
  try {
    result = await promise;
  } catch (err) {
    throw new NetworkError(
      err instanceof Error ? err.message : 'Network request failed',
      err,
    );
  }

  const { data, error, response } = result;
  // Any 2xx is success. `data` may be undefined for 204 No Content (e.g.
  // DELETE endpoints) — callers that don't use the return value get
  // `undefined` cast as T, which is fine for `await callApi(...)`.
  if (response.ok) return data as T;

  if (response.status === 401) handleUnauthorized();
  // openapi-fetch already read+parsed the body into `error` — the Response
  // stream is consumed, so re-reading response.text() here would throw.
  throw buildApiError(response.status, error);
}

/**
 * Light healthcheck — fetches Vikunja's /info (no auth needed). Used during
 * login to verify the URL is reachable and points at a Vikunja instance.
 */
export async function probeServer(
  serverUrl: string,
): Promise<{ version: string | null; frontendUrl: string | null }> {
  const client = createClient<paths>({
    baseUrl: `${normalizeBase(serverUrl)}/api/v1`,
    fetch: platformFetch,
  });
  const info = await callApi(client.GET('/info'));
  return {
    version: info.version ?? null,
    frontendUrl: (info as { frontend_url?: string }).frontend_url || null,
  };
}
