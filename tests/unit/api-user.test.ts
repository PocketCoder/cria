import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchCurrentUser } from '@/api/user';

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

describe('fetchCurrentUser', () => {
  it('returns a User from server payload', async () => {
    mockCallApi.mockResolvedValue({
      id: 42,
      username: 'alice',
      email: 'alice@example.com',
      name: 'Alice',
      settings: { default_project_id: 5, language: 'de', timezone: 'Europe/Berlin' },
    });

    const user = await fetchCurrentUser(mockClient as never);
    expect(mockCallApi).toHaveBeenCalledOnce();
    expect(user.serverId).toBe(42);
    expect(user.username).toBe('alice');
    expect(user.email).toBe('alice@example.com');
    expect(user.name).toBe('Alice');
    expect(user.defaultProjectId).toBe(5);
    expect(user.language).toBe('de');
    expect(user.timezone).toBe('Europe/Berlin');
    expect(user.fetchedAt).toBeTruthy();
    expect(user.raw).toEqual({
      id: 42,
      username: 'alice',
      email: 'alice@example.com',
      name: 'Alice',
      settings: { default_project_id: 5, language: 'de', timezone: 'Europe/Berlin' },
    });
  });

  it('handles minimal payload with defaults', async () => {
    mockCallApi.mockResolvedValue({ id: 1, username: 'bot' });
    const user = await fetchCurrentUser(mockClient as never);
    expect(user.serverId).toBe(1);
    expect(user.username).toBe('bot');
    expect(user.email).toBeNull();
    expect(user.name).toBeNull();
    expect(user.defaultProjectId).toBeNull();
    expect(user.language).toBe('en');
    expect(user.timezone).toBe('UTC');
  });

  it('uses createApiClient when no client passed', async () => {
    mockCallApi.mockResolvedValue({ id: 1, username: 'x' });
    await fetchCurrentUser();
    expect(mockCreateApiClient).toHaveBeenCalledOnce();
  });

  it('throws when callApi rejects', async () => {
    mockCallApi.mockRejectedValue(new Error('API error'));
    await expect(fetchCurrentUser(mockClient as never)).rejects.toThrow('API error');
  });

  it('throws on malformed payload (missing id)', async () => {
    mockCallApi.mockResolvedValue({ username: 'noid' });
    await expect(fetchCurrentUser(mockClient as never)).rejects.toThrow();
  });
});
