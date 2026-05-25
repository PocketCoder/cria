import createClient, { type Client } from 'openapi-fetch';
import type { paths } from './schema';
import { buildApiError, NetworkError } from './errors';
import { getAuthSnapshot } from '@/auth/store';

export type ApiClient = Client<paths>;

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
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
  if (response.ok && data !== undefined) return data;

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
  });
  const info = await callApi(client.GET('/info'));
  return { version: info.version ?? null };
}
