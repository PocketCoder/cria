import type { ApiRouteGroup } from '@/api/account';

export interface PermissionGroup {
  group: string;
  permissions: { id: string; label: string }[];
}

/**
 * Derive permission groups from the /routes API response.
 * Each group key maps to a set of standard CRUD permissions
 * (read_all, create, update, delete).
 */
const STANDARD_PERMISSIONS = [
  { id: 'read_all', label: 'Read all' },
  { id: 'create', label: 'Create' },
  { id: 'update', label: 'Update' },
  { id: 'delete', label: 'Delete' },
];

export function routesToGroups(routes: ApiRouteGroup[]): PermissionGroup[] {
  const seen = new Set<string>();
  const groups: PermissionGroup[] = [];
  for (const entry of routes) {
    for (const key of Object.keys(entry)) {
      if (!seen.has(key)) {
        seen.add(key);
        groups.push({
          group: key,
          permissions: STANDARD_PERMISSIONS.map((p) => ({
            id: `${key}:${p.id}`,
            label: p.label,
          })),
        });
      }
    }
  }
  groups.sort((a, b) => a.group.localeCompare(b.group));
  return groups;
}

/**
 * Convert a flat list of selected permission IDs (e.g. `["tasks:read_all", "tasks:create"]`)
 * to the API format: `{ tasks: ["read_all", "create"] }`.
 */
export function selectionToPermissions(
  selected: string[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const id of selected) {
    const colon = id.indexOf(':');
    if (colon === -1) continue;
    const group = id.slice(0, colon);
    const perm = id.slice(colon + 1);
    (result[group] ??= []).push(perm);
  }
  return result;
}
