import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/api/notifications';

const { mockCallApi, mockCreateApiClient } = vi.hoisted(() => ({
  mockCallApi: vi.fn(),
  mockCreateApiClient: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  callApi: mockCallApi,
  createApiClient: mockCreateApiClient,
}));

const mockClient = { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateApiClient.mockReturnValue(mockClient);
});

describe('notifications api', () => {
  it('listNotifications GETs /notifications and maps read state', async () => {
    mockCallApi.mockResolvedValue([
      {
        id: 1,
        name: 'task.assigned',
        notification: { task: { id: 42, title: 'T' }, doer: { username: 'a' } },
        read_at: '0001-01-01T00:00:00Z',
        created: '2026-07-01T00:00:00Z',
      },
      {
        id: 2,
        name: 'task.comment',
        notification: {},
        read_at: '2026-07-02T10:00:00Z',
        created: '2026-07-02T00:00:00Z',
      },
    ]);
    const items = await listNotifications();
    expect(mockClient.GET).toHaveBeenCalledWith('/notifications', {
      params: { query: { page: 1, per_page: 50 } },
    });
    expect(items).toHaveLength(2);
    expect(items[0]!.read).toBe(false); // zero timestamp = unread
    expect(items[1]!.read).toBe(true);
    expect(items[0]!.name).toBe('task.assigned');
  });

  it('markNotificationRead POSTs /notifications/{id}', async () => {
    mockCallApi.mockResolvedValue({});
    await markNotificationRead(5);
    expect(mockClient.POST).toHaveBeenCalledWith('/notifications/{id}', {
      params: { path: { id: 5 } },
    });
  });

  it('markAllNotificationsRead POSTs /notifications', async () => {
    mockCallApi.mockResolvedValue({});
    await markAllNotificationsRead();
    expect(mockClient.POST).toHaveBeenCalledWith('/notifications');
  });
});
