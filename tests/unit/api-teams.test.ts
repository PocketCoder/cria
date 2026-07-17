import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listTeams,
  createTeam,
  renameTeam,
  deleteTeam,
  getTeam,
  addTeamMember,
  removeTeamMember,
  toggleTeamAdmin,
} from '@/api/teams';

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
  mockCallApi.mockResolvedValue([]);
});

describe('teams api', () => {
  it('listTeams GETs /teams and maps results', async () => {
    mockCallApi.mockResolvedValue([{ id: 1, name: 'Family', description: '' }]);
    const teams = await listTeams();
    expect(mockClient.GET).toHaveBeenCalledWith('/teams', { params: { query: {} } });
    expect(teams).toEqual([{ serverId: 1, name: 'Family', description: null }]);
  });

  it('createTeam PUTs /teams', async () => {
    mockCallApi.mockResolvedValue({ id: 2, name: 'Work' });
    const t = await createTeam('Work');
    expect(mockClient.PUT).toHaveBeenCalledWith('/teams', { body: { name: 'Work' } });
    expect(t.serverId).toBe(2);
  });

  it('renameTeam POSTs /teams/{id}', async () => {
    mockCallApi.mockResolvedValue({});
    await renameTeam(2, 'New name');
    expect(mockClient.POST).toHaveBeenCalledWith('/teams/{id}', {
      params: { path: { id: 2 } },
      body: { name: 'New name' },
    });
  });

  it('deleteTeam DELETEs /teams/{id}', async () => {
    mockCallApi.mockResolvedValue({});
    await deleteTeam(2);
    expect(mockClient.DELETE).toHaveBeenCalledWith('/teams/{id}', {
      params: { path: { id: 2 } },
    });
  });

  it('getTeam GETs /teams/{id} and maps members', async () => {
    mockCallApi.mockResolvedValue({
      id: 2,
      name: 'Work',
      members: [{ id: 9, username: 'alice', name: 'Alice', admin: true }],
    });
    const team = await getTeam(2);
    expect(team.members).toEqual([
      { serverId: 9, username: 'alice', name: 'Alice', admin: true },
    ]);
  });

  it('addTeamMember PUTs the username', async () => {
    mockCallApi.mockResolvedValue({});
    await addTeamMember(2, 'bob');
    expect(mockClient.PUT).toHaveBeenCalledWith('/teams/{id}/members', {
      params: { path: { id: 2 } },
      body: { username: 'bob' },
    });
  });

  it('removeTeamMember DELETEs by username', async () => {
    mockCallApi.mockResolvedValue({});
    await removeTeamMember(2, 'bob');
    expect(mockClient.DELETE).toHaveBeenCalledWith('/teams/{id}/members/{username}', {
      params: { path: { id: 2, username: 'bob' } },
    });
  });

  it('toggleTeamAdmin POSTs the admin toggle', async () => {
    mockCallApi.mockResolvedValue({});
    await toggleTeamAdmin(2, 9);
    expect(mockClient.POST).toHaveBeenCalledWith('/teams/{id}/members/{userID}/admin', {
      params: { path: { id: 2, userID: 9 } },
    });
  });
});
