import { type ApiClient, callApi, createApiClient } from './client';
import { userFromResponse, type User } from '@/domain/user';

export async function fetchCurrentUser(
  client: ApiClient = createApiClient(),
): Promise<User> {
  const payload = await callApi(client.GET('/user'));
  return userFromResponse(payload);
}
