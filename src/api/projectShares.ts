import { type ApiClient, callApi, createApiClient } from './client';

/** Vikunja permission levels: 0 read, 1 read+write, 2 admin. */
export type Permission = 0 | 1 | 2;

export const PERMISSION_LABELS: Record<Permission, string> = {
  0: 'Read only',
  1: 'Read & write',
  2: 'Admin',
};

export interface UserShare {
  serverId: number;
  username: string;
  name: string | null;
  permission: Permission;
}

export interface TeamShare {
  serverId: number;
  name: string;
  permission: Permission;
}

export interface LinkShare {
  id: number;
  hash: string;
  name: string | null;
  permission: Permission;
  hasPassword: boolean;
  sharedByName: string | null;
}

/* ── users ── */

export async function listProjectUsers(
  projectId: number,
  client: ApiClient = createApiClient(),
): Promise<UserShare[]> {
  const data = (await callApi(
    client.GET('/projects/{id}/users', { params: { path: { id: projectId } } }),
  )) as Array<{ id?: number; username?: string; name?: string; permission?: number }> | null;
  return (data ?? [])
    .filter((u) => typeof u.id === 'number' && u.username)
    .map((u) => ({
      serverId: u.id!,
      username: u.username!,
      name: u.name || null,
      permission: (u.permission ?? 0) as Permission,
    }));
}

export async function addProjectUser(
  projectId: number,
  username: string,
  permission: Permission,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.PUT('/projects/{id}/users', {
      params: { path: { id: projectId } },
      body: { username, permission },
    }),
  );
}

export async function updateProjectUserPermission(
  projectId: number,
  userId: number,
  permission: Permission,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/projects/{projectID}/users/{userID}', {
      params: { path: { projectID: projectId, userID: userId } },
      body: { permission },
    }),
  );
}

export async function removeProjectUser(
  projectId: number,
  userId: number,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.DELETE('/projects/{projectID}/users/{userID}', {
      params: { path: { projectID: projectId, userID: userId } },
    }),
  );
}

/* ── teams ── */

export async function listProjectTeams(
  projectId: number,
  client: ApiClient = createApiClient(),
): Promise<TeamShare[]> {
  const data = (await callApi(
    client.GET('/projects/{id}/teams', { params: { path: { id: projectId } } }),
  )) as Array<{ id?: number; name?: string; permission?: number }> | null;
  return (data ?? [])
    .filter((t) => typeof t.id === 'number')
    .map((t) => ({
      serverId: t.id!,
      name: t.name ?? '',
      permission: (t.permission ?? 0) as Permission,
    }));
}

export async function addProjectTeam(
  projectId: number,
  teamId: number,
  permission: Permission,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.PUT('/projects/{id}/teams', {
      params: { path: { id: projectId } },
      body: { team_id: teamId, permission },
    }),
  );
}

export async function updateProjectTeamPermission(
  projectId: number,
  teamId: number,
  permission: Permission,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/projects/{projectID}/teams/{teamID}', {
      params: { path: { projectID: projectId, teamID: teamId } },
      body: { permission },
    }),
  );
}

export async function removeProjectTeam(
  projectId: number,
  teamId: number,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.DELETE('/projects/{projectID}/teams/{teamID}', {
      params: { path: { projectID: projectId, teamID: teamId } },
    }),
  );
}

/* ── link shares ── */

export async function listLinkShares(
  projectId: number,
  client: ApiClient = createApiClient(),
): Promise<LinkShare[]> {
  const data = (await callApi(
    client.GET('/projects/{project}/shares', {
      params: { path: { project: projectId } },
    }),
  )) as Array<{
    id?: number;
    hash?: string;
    name?: string;
    permission?: number;
    sharing_type?: number;
    shared_by?: { name?: string; username?: string };
  }> | null;
  return (data ?? [])
    .filter((s) => typeof s.id === 'number' && s.hash)
    .map((s) => ({
      id: s.id!,
      hash: s.hash!,
      name: s.name || null,
      permission: (s.permission ?? 0) as Permission,
      hasPassword: s.sharing_type === 2,
      sharedByName: s.shared_by?.name || s.shared_by?.username || null,
    }));
}

export async function createLinkShare(
  projectId: number,
  input: { permission: Permission; name?: string; password?: string },
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.PUT('/projects/{project}/shares', {
      params: { path: { project: projectId } },
      body: {
        permission: input.permission,
        ...(input.name ? { name: input.name } : {}),
        ...(input.password ? { password: input.password } : {}),
        // 1 = plain link, 2 = password-protected (models.SharingType).
        sharing_type: input.password ? 2 : 1,
      },
    }),
  );
}

export async function deleteLinkShare(
  projectId: number,
  shareId: number,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.DELETE('/projects/{project}/shares/{share}', {
      params: { path: { project: projectId, share: shareId } },
    }),
  );
}
