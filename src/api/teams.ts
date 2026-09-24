import { type ApiClient, callApi, createApiClient } from './client';

export interface Team {
  serverId: number;
  name: string;
  description: string | null;
}

export interface TeamMember {
  serverId: number;
  username: string;
  name: string | null;
  admin: boolean;
}

export interface TeamWithMembers extends Team {
  members: TeamMember[];
}

interface TeamPayload {
  id?: number;
  name?: string;
  description?: string;
  members?: Array<{ id?: number; username?: string; name?: string; admin?: boolean }>;
}

function toTeam(t: TeamPayload): Team {
  return {
    serverId: t.id ?? 0,
    name: t.name ?? '',
    description: t.description || null,
  };
}

export async function listTeams(
  client: ApiClient = createApiClient(),
): Promise<Team[]> {
  const data = (await callApi(
    client.GET('/teams', { params: { query: {} } }),
  )) as TeamPayload[] | null;
  return (data ?? []).filter((t) => typeof t.id === 'number').map(toTeam);
}

export async function getTeam(
  teamId: number,
  client: ApiClient = createApiClient(),
): Promise<TeamWithMembers> {
  const data = (await callApi(
    client.GET('/teams/{id}', { params: { path: { id: teamId } } }),
  )) as TeamPayload;
  return {
    ...toTeam(data),
    members: (data.members ?? [])
      .filter((m) => typeof m.id === 'number' && m.username)
      .map((m) => ({
        serverId: m.id!,
        username: m.username!,
        name: m.name || null,
        admin: m.admin === true,
      })),
  };
}

export async function createTeam(
  name: string,
  client: ApiClient = createApiClient(),
): Promise<Team> {
  const data = (await callApi(
    client.PUT('/teams', { body: { name } }),
  )) as TeamPayload;
  return toTeam(data);
}

export async function renameTeam(
  teamId: number,
  name: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/teams/{id}', {
      params: { path: { id: teamId } },
      body: { name },
    }),
  );
}

export async function deleteTeam(
  teamId: number,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.DELETE('/teams/{id}', { params: { path: { id: teamId } } }),
  );
}

export async function addTeamMember(
  teamId: number,
  username: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.PUT('/teams/{id}/members', {
      params: { path: { id: teamId } },
      body: { username },
    }),
  );
}

export async function removeTeamMember(
  teamId: number,
  username: string,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.DELETE('/teams/{id}/members/{username}', {
      // Schema mistypes username as number (upstream swagger bug) — the
      // API expects the username string in the path.
      params: { path: { id: teamId, username: username as unknown as number } },
    }),
  );
}

/** Toggles the member's team-admin flag (server flips the current value). */
export async function toggleTeamAdmin(
  teamId: number,
  userId: number,
  client: ApiClient = createApiClient(),
): Promise<void> {
  await callApi(
    client.POST('/teams/{id}/members/{userID}/admin', {
      params: { path: { id: teamId, userID: userId } },
    }),
  );
}
