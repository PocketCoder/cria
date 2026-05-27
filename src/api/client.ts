import createClient, { type Client } from 'openapi-fetch';
import type { paths } from './schema';
import { buildApiError, NetworkError } from './errors';
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

let cachedTauriFetch:
  | ((input: Request) => Promise<Response>)
  | null = null;

async function platformFetch(request: Request): Promise<Response> {
  if (isTauri) {
    if (!cachedTauriFetch) {
      const mod = await import('@tauri-apps/plugin-http');
      cachedTauriFetch = mod.fetch as (input: Request) => Promise<Response>;
    }
    return cachedTauriFetch(request);
  }
  return globalThis.fetch(request);
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
