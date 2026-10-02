import type { Permission } from '@/api/projectShares';

/** Teams not yet shared with the project (by server id). */
export function availableTeams<T extends { serverId: number }>(
  allTeams: T[] | undefined,
  shared: { serverId: number }[] | undefined,
): T[] {
  const sharedList = shared ?? [];
  return (allTeams ?? []).filter((t) => !sharedList.some((s) => s.serverId === t.serverId));
}

/** Message for a failed share mutation, or null. */
export function shareErrorMessage(error: unknown): string | null {
  if (!error) return null;
  return String((error as Error).message ?? error);
}

/** Link-share create payload: blank name/password are omitted. */
export function buildLinkShareInput(
  permission: Permission,
  name: string,
  password: string,
): { permission: Permission; name: string | undefined; password: string | undefined } {
  return {
    permission,
    name: name.trim() || undefined,
    password: password || undefined,
  };
}

/** Parse the team `<select>` value: empty string means none. */
export function parseTeamSelection(value: string): number | '' {
  return value ? Number(value) : '';
}
