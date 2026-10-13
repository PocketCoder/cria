import { describe, expect, it } from 'vitest';
import type { Project } from '@/domain/project';
import { siblingProjects } from '@/features/projects/projectTree';
import { computeDropPosition } from '@/features/projects/sidebarLogic';

const proj = (localId: string, parentLocalId: string | null = null, position: number | null = null) =>
  ({ localId, title: localId, serverId: 1, parentLocalId, position }) as unknown as Project;

describe('siblingProjects', () => {
  const list = [
    proj('a', null, 1000),
    proj('a1', 'a', 1000),
    proj('a2', 'a', 2000),
    proj('b', null, 2000),
  ];
  const ids = new Set(list.map((p) => p.localId));

  it('returns the same-parent rows in tree order', () => {
    expect(siblingProjects(list, ids, 'a2').map((p) => p.localId)).toEqual(['a1', 'a2']);
    expect(siblingProjects(list, ids, 'b').map((p) => p.localId)).toEqual(['a', 'b']);
  });

  it('treats a project whose parent is hidden as a root', () => {
    const visible = new Set(['a1', 'b']);
    const rows = [list[1]!, list[3]!];
    expect(siblingProjects(rows, visible, 'a1').map((p) => p.localId)).toEqual(['a1', 'b']);
  });

  it('is empty for an unknown id', () => {
    expect(siblingProjects(list, ids, 'zz')).toEqual([]);
  });

  it('gives a sub-project drop a position between its own siblings', () => {
    const sibs = siblingProjects(list, ids, 'a2');
    expect(computeDropPosition(sibs, 'a2', 0)).toBe((0 + 1000) / 2);
  });
});
