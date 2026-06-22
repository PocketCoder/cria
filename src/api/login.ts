import createClient from 'openapi-fetch';
import type { paths } from './schema';
import { platformFetch, callApi } from './client';
import { ApiError } from './errors';

export interface PasswordLoginInput {
  username: string;
  password: string;
  long_token?: boolean;
  totp_passcode?: string;
}

export async function loginWithPassword(
  serverUrl: string,
  input: PasswordLoginInput,
): Promise<string> {
  const client = createClient<paths>({
    baseUrl: `${serverUrl.replace(/\/+$/, '')}/api/v1`,
    fetch: platformFetch,
  });

  const result = await callApi(
    client.POST('/login', {
      body: {
        username: input.username,
        password: input.password,
        long_token: input.long_token ?? true,
        totp_passcode: input.totp_passcode,
      },
    }),
  );

  return result.token!;
}

export function isTotpRequired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 412;
}
