import createClient from 'openapi-fetch';
import type { paths } from './schema';
import { apiFetch, guardDestination, readRefreshCookie, refreshApiVersion } from './client';
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
  // The logical v1 base: the adapter moves login to /api/v2 on a v2 server.
  const baseUrl = `${serverUrl.replace(/\/+$/, '')}/api/v1`;
  // Independent of whatever URL validation the caller (e.g. the login form)
  // already did — this is the last line of defense before the password goes
  // out over the wire.
  guardDestination(baseUrl);

  // Re-decide v1 or v2 for this server before the first credentialed call; the
  // session's refresh then uses the same version (the cookie is set for both).
  await refreshApiVersion(serverUrl);

  const client = createClient<paths>({
    baseUrl,
    fetch: apiFetch,
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
    // openapi-fetch already read+parsed the body into `error` — the
    // Response stream is consumed, so re-reading response.text() here
    // would throw and mask the server's real error message.
    throw buildApiError(response.status, error);
  }

  return {
    token: (data as { token?: string }).token!,
    refreshToken: readRefreshCookie(response.headers),
  };
}

/**
 * The login needs a TOTP passcode. Vikunja answers HTTP 412 with code 1017
 * (ErrInvalidTOTPPasscode) on v1, and v2 keeps both (its domain errors map to
 * problem+json with the same status and numeric code; only validation errors
 * became 422). Either signal counts, so a server that changes the status still
 * works. A 422 without that code is a validation failure, not TOTP.
 */
export const TOTP_REQUIRED_CODE = 1017;

export function isTotpRequired(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 412 || err.code === TOTP_REQUIRED_CODE);
}
