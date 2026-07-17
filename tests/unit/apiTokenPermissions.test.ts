import { describe, it, expect } from 'vitest';
import { routesToGroups, selectionToPermissions } from '@/lib/apiTokenPermissions';
import type { ApiRouteGroup } from '@/api/account';

describe('routesToGroups', () => {
  it('extracts unique group keys from route response', () => {
    const routes: ApiRouteGroup[] = [
      { tasks: { method: 'GET', path: '/tasks' } },
      { tasks: { method: 'POST', path: '/tasks' } },
      { projects: { method: 'GET', path: '/projects' } },
    ];
    const groups = routesToGroups(routes);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.group).toBe('projects');
    expect(groups[1]!.group).toBe('tasks');
  });

  it('assigns standard CRUD permissions to each group', () => {
    const routes: ApiRouteGroup[] = [{ labels: { method: 'GET', path: '/labels' } }];
    const groups = routesToGroups(routes);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.permissions).toEqual([
      { id: 'labels:read_all', label: 'Read all' },
      { id: 'labels:create', label: 'Create' },
      { id: 'labels:update', label: 'Update' },
      { id: 'labels:delete', label: 'Delete' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(routesToGroups([])).toEqual([]);
  });
});

describe('selectionToPermissions', () => {
  it('converts flat permission IDs to grouped Record', () => {
    const result = selectionToPermissions([
      'tasks:read_all',
      'tasks:create',
      'projects:read_all',
    ]);
    expect(result).toEqual({
      tasks: ['read_all', 'create'],
      projects: ['read_all'],
    });
  });

  it('skips malformed IDs with no colon', () => {
    expect(selectionToPermissions(['bad'])).toEqual({});
  });

  it('returns empty object for empty input', () => {
    expect(selectionToPermissions([])).toEqual({});
  });
});
