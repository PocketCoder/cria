import { type ApiClient, callApi, createApiClient } from './client';

export interface UserSearchResult {
  serverId: number;
  username: string;
  name: string | null;
}

interface UserPayload {
  id?: number;
  username?: string;
  name?: string;
}

/** Search all users known to the server (GET /users?s=). */
export async function searchUsers(
  query: string,
  client: ApiClient = createApiClient(),
): Promise<UserSearchResult[]> {
  const data = (await callApi(
    client.GET('/users', { params: { query: { s: query } } }),
  )) as UserPayload[] | null;
  return (data ?? [])
    .filter((u) => typeof u.id === 'number' && u.username)
    .map((u) => ({
      serverId: u.id!,
      username: u.username!,
      name: u.name || null,
    }));
}
