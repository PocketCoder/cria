import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchUsers, searchProjectUsers } from '@/api/users';

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

describe('searchUsers', () => {
  it('GETs /users with the search string and maps the result', async () => {
    mockCallApi.mockResolvedValue([
      { id: 1, username: 'alice', name: 'Alice A' },
      { id: 2, username: 'bob', name: '' },
    ]);
    const users = await searchUsers('al');
    expect(mockClient.GET).toHaveBeenCalledWith('/users', {
      params: { query: { s: 'al' } },
    });
    expect(users).toEqual([
      { serverId: 1, username: 'alice', name: 'Alice A' },
      { serverId: 2, username: 'bob', name: null },
    ]);
  });

  it('returns [] for a null response', async () => {
    mockCallApi.mockResolvedValue(null);
    expect(await searchUsers('x')).toEqual([]);
  });
});

describe('searchProjectUsers', () => {
  it('GETs /projects/{id}/projectusers with the search string', async () => {
    mockCallApi.mockResolvedValue([{ id: 3, username: 'carol', name: 'Carol' }]);
    const users = await searchProjectUsers(7, 'ca');
    expect(mockClient.GET).toHaveBeenCalledWith('/projects/{id}/projectusers', {
      params: { path: { id: 7 }, query: { s: 'ca' } },
    });
    expect(users).toEqual([{ serverId: 3, username: 'carol', name: 'Carol' }]);
  });
});
