import { type ApiClient, callApi, createApiClient } from './client';

export interface Notification {
  id: number;
  name: string;
  payload: unknown;
  read: boolean;
  created: string | null;
}

interface NotificationRow {
  id?: number;
  name?: string;
  notification?: unknown;
  read_at?: string;
  created?: string;
}

/** Go's zero time — Vikunja sends this for unread notifications. */
const ZERO_TIME = '0001-01-01T00:00:00Z';

export async function listNotifications(
  client: ApiClient = createApiClient(),
): Promise<Notification[]> {
  const data = (await callApi(
    client.GET('/notifications', {
      params: { query: { page: 1, per_page: 50 } },
    }),
  )) as NotificationRow[] | null;
  return (data ?? [])
    .filter((n) => typeof n.id === 'number')
    .map((n) => ({
      id: n.id!,
      name: n.name ?? '',
      payload: n.notification ?? null,
      read: !!n.read_at && n.read_at !== ZERO_TIME,
      created: n.created ?? null,
    }));
}

export async function markNotificationRead(
  id: number,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/notifications/{id}', { params: { path: { id } } }),
  );
}

export async function markAllNotificationsRead(
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(client.POST('/notifications'));
}
