import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listProjectUsers,
  addProjectUser,
  updateProjectUserPermission,
  removeProjectUser,
  listProjectTeams,
  addProjectTeam,
  updateProjectTeamPermission,
  removeProjectTeam,
  listLinkShares,
  createLinkShare,
  deleteLinkShare,
} from '@/api/projectShares';

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

describe('project user shares', () => {
  it('listProjectUsers GETs /projects/{id}/users', async () => {
    await listProjectUsers(7);
    expect(mockClient.GET).toHaveBeenCalledWith('/projects/{id}/users', {
      params: { path: { id: 7 } },
    });
  });

  it('addProjectUser PUTs username + permission', async () => {
    mockCallApi.mockResolvedValue({});
    await addProjectUser(7, 'alice', 1);
    expect(mockClient.PUT).toHaveBeenCalledWith('/projects/{id}/users', {
      params: { path: { id: 7 } },
      body: { username: 'alice', permission: 1 },
    });
  });

  it('updateProjectUserPermission POSTs the new permission', async () => {
    mockCallApi.mockResolvedValue({});
    await updateProjectUserPermission(7, 42, 2);
    expect(mockClient.POST).toHaveBeenCalledWith('/projects/{projectID}/users/{userID}', {
      params: { path: { projectID: 7, userID: 42 } },
      body: { permission: 2 },
    });
  });

  it('removeProjectUser DELETEs the relation', async () => {
    mockCallApi.mockResolvedValue({});
    await removeProjectUser(7, 42);
    expect(mockClient.DELETE).toHaveBeenCalledWith('/projects/{projectID}/users/{userID}', {
      params: { path: { projectID: 7, userID: 42 } },
    });
  });
});

describe('project team shares', () => {
  it('listProjectTeams GETs /projects/{id}/teams', async () => {
    await listProjectTeams(7);
    expect(mockClient.GET).toHaveBeenCalledWith('/projects/{id}/teams', {
      params: { path: { id: 7 } },
    });
  });

  it('addProjectTeam PUTs team_id + permission', async () => {
    mockCallApi.mockResolvedValue({});
    await addProjectTeam(7, 3, 0);
    expect(mockClient.PUT).toHaveBeenCalledWith('/projects/{id}/teams', {
      params: { path: { id: 7 } },
      body: { team_id: 3, permission: 0 },
    });
  });

  it('updateProjectTeamPermission POSTs the new permission', async () => {
    mockCallApi.mockResolvedValue({});
    await updateProjectTeamPermission(7, 3, 1);
    expect(mockClient.POST).toHaveBeenCalledWith('/projects/{projectID}/teams/{teamID}', {
      params: { path: { projectID: 7, teamID: 3 } },
      body: { permission: 1 },
    });
  });

  it('removeProjectTeam DELETEs the relation', async () => {
    mockCallApi.mockResolvedValue({});
    await removeProjectTeam(7, 3);
    expect(mockClient.DELETE).toHaveBeenCalledWith('/projects/{projectID}/teams/{teamID}', {
      params: { path: { projectID: 7, teamID: 3 } },
    });
  });
});

describe('link shares', () => {
  it('listLinkShares GETs /projects/{project}/shares', async () => {
    await listLinkShares(7);
    expect(mockClient.GET).toHaveBeenCalledWith('/projects/{project}/shares', {
      params: { path: { project: 7 } },
    });
  });

  it('createLinkShare derives sharing_type from the password', async () => {
    mockCallApi.mockResolvedValue({ id: 1, hash: 'abc' });
    await createLinkShare(7, { permission: 1, name: 'For mum' });
    expect(mockClient.PUT).toHaveBeenCalledWith('/projects/{project}/shares', {
      params: { path: { project: 7 } },
      body: { permission: 1, name: 'For mum', sharing_type: 1 },
    });

    await createLinkShare(7, { permission: 0, password: 'hunter2' });
    expect(mockClient.PUT).toHaveBeenLastCalledWith('/projects/{project}/shares', {
      params: { path: { project: 7 } },
      body: { permission: 0, password: 'hunter2', sharing_type: 2 },
    });
  });

  it('deleteLinkShare DELETEs /projects/{project}/shares/{share}', async () => {
    mockCallApi.mockResolvedValue({});
    await deleteLinkShare(7, 5);
    expect(mockClient.DELETE).toHaveBeenCalledWith('/projects/{project}/shares/{share}', {
      params: { path: { project: 7, share: 5 } },
    });
  });
});
