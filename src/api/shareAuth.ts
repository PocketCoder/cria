import createClient from 'openapi-fetch';
import type { paths } from './schema';
import { platformFetch } from './client';
import { NetworkError, buildApiError } from './errors';

/** Vikunja error code: this link share needs a password. */
export const SHARE_PASSWORD_REQUIRED_CODE = 13001;

export interface ShareAuthResult {
  /** JWT scoped to the shared project. */
  token: string;
}

/**
 * Exchange a link-share hash (+ password when the share requires one) for a
 * JWT — upstream's /share/{hash}/auth flow. Unauthenticated call.
 */
export async function authLinkShare(
  serverUrl: string,
  hash: string,
  password?: string,
): Promise<ShareAuthResult> {
  const client = createClient<paths>({
    baseUrl: `${serverUrl.replace(/\/+$/, '')}/api/v1`,
    fetch: platformFetch,
  });

  let result;
  try {
    result = await client.POST('/shares/{share}/auth', {
      params: { path: { share: hash } },
      body: { password: password ?? '' },
    });
  } catch (err) {
    throw new NetworkError(
      err instanceof Error ? err.message : 'Network request failed',
      err,
    );
  }

  const { data, error, response } = result;
  if (!response.ok) {
    // openapi-fetch already consumed the body into `error` — re-reading
    // response.text() here would throw on the drained stream.
    throw buildApiError(response.status, error);
  }
  const token = (data as { token?: string }).token;
  if (!token) throw new Error('Share auth response had no token');
  return { token };
}
