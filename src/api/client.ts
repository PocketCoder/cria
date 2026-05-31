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
import { getAuthSnapshot } from '@/auth/store';

export type ApiClient = Client<paths>;

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

/**
 * Public so other modules that bypass openapi-fetch (e.g. multipart
 * uploads and blob downloads in `sync/attachments.ts`) can share the
 * same CORS-dodge + import-once cache instead of reimplementing it.
 */
export async function platformFetch(
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
export function createApiClient(opts?: {
  baseUrl?: string;
  token?: string;
}): ApiClient {
  const snap = getAuthSnapshot();
  const baseUrl = `${normalizeBase(opts?.baseUrl ?? snap.serverUrl ?? '')}/api/v1`;
  const token = opts?.token ?? snap.token ?? '';

  return createClient<paths>({
    baseUrl,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    fetch: platformFetch,
  });
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

  const { data, response } = result;
  // Any 2xx is success. `data` may be undefined for 204 No Content (e.g.
  // DELETE endpoints) — callers that don't use the return value get
  // `undefined` cast as T, which is fine for `await callApi(...)`.
  if (response.ok) return data as T;

  const bodyText = await response.text().catch(() => '');
  throw await buildApiError(response.status, bodyText);
}

/**
 * Light healthcheck — fetches Vikunja's /info (no auth needed). Used during
 * login to verify the URL is reachable and points at a Vikunja instance.
 */
export async function probeServer(
  serverUrl: string,
): Promise<{ version: string | null }> {
  const client = createClient<paths>({
    baseUrl: `${normalizeBase(serverUrl)}/api/v1`,
    fetch: platformFetch,
  });
  const info = await callApi(client.GET('/info'));
  return { version: info.version ?? null };
}
