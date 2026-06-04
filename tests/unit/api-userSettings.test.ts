import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushUserSettings } from '@/api/userSettings';

const { mockCallApi, mockCreateApiClient } = vi.hoisted(() => ({
  mockCallApi: vi.fn(),
  mockCreateApiClient: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  callApi: mockCallApi,
  createApiClient: mockCreateApiClient,
  probeServer: vi.fn(),
}));

const mockClient = { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateApiClient.mockReturnValue(mockClient);
});

describe('pushUserSettings', () => {
  it('posts settings via callApi', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await pushUserSettings({ language: 'de' }, mockClient as never);
    expect(mockCallApi).toHaveBeenCalledOnce();
  });

  it('uses createApiClient when no client passed', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await pushUserSettings({ language: 'de' });
    expect(mockCreateApiClient).toHaveBeenCalledOnce();
  });

  it('passes the full settings object as body', async () => {
    mockClient.POST.mockReturnValue(Promise.resolve({ data: undefined }));
    mockCallApi.mockImplementation(async (p: unknown) => p);
    const settings = {
      language: 'de',
      timezone: 'Europe/Berlin',
      week_start: 1,
      name: 'Alice',
      email_reminders_enabled: true,
      overdue_tasks_reminders_enabled: false,
      overdue_tasks_reminders_time: '09:00',
    };
    await pushUserSettings(settings, mockClient as never);
    expect(mockClient.POST).toHaveBeenCalledWith('/user/settings/general', {
      body: settings,
    });
  });

  it('sends minimal settings object', async () => {
    mockCallApi.mockResolvedValue(undefined);
    await pushUserSettings({ name: 'Bot' }, mockClient as never);
    expect(mockCallApi).toHaveBeenCalled();
  });

  it('propagates API errors', async () => {
    mockCallApi.mockRejectedValue(new Error('Forbidden'));
    await expect(
      pushUserSettings({ language: 'de' }, mockClient as never),
    ).rejects.toThrow('Forbidden');
  });
});
