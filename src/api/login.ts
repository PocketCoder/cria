import createClient from 'openapi-fetch';
import type { paths } from './schema';
import { platformFetch, readRefreshCookie } from './client';
import { ApiError, NetworkError, buildApiError } from './errors';

export interface PasswordLoginInput {
  username: string;
  password: string;
  long_token?: boolean;
  totp_passcode?: string;
}

export interface PasswordLoginResult {
  /** Short-lived access JWT. */
  token: string;
  /** Refresh token from the login cookie, used to mint fresh JWTs as the access
   *  token expires. Null if the server didn't set one (older Vikunja). */
  refreshToken: string | null;
}

export async function loginWithPassword(
  serverUrl: string,
  input: PasswordLoginInput,
): Promise<PasswordLoginResult> {
  const client = createClient<paths>({
    baseUrl: `${serverUrl.replace(/\/+$/, '')}/api/v1`,
    fetch: platformFetch,
  });

  // Inlined (not callApi) because we need the raw response to read the
  // HttpOnly refresh-token cookie, which callApi discards.
  let result;
  try {
    result = await client.POST('/login', {
      body: {
        username: input.username,
        password: input.password,
        long_token: input.long_token ?? true,
        totp_passcode: input.totp_passcode,
      },
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

  return {
    token: (data as { token?: string }).token!,
    refreshToken: readRefreshCookie(response.headers),
  };
}

export function isTotpRequired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 412;
}
