import { type ApiClient, callApi, createApiClient } from './client';
import { normaliseDate } from '@/domain/task';

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
      // Vikunja sends Go's zero time for unread notifications.
      read: normaliseDate(n.read_at) !== null,
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
