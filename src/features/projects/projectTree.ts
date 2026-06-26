import { useState } from 'react';
import type { Project } from '@/domain/project';

/**
 * Direct children of `parentLocalId` (null = roots), built client-side from
 * `parentLocalId` — Vikunja keeps the hierarchy flat on the wire. A project
 * whose parent isn't in `visibleIds` surfaces as a root so nothing is hidden.
 * Order follows the input array (already position-sorted by the query).
 */
export function childProjectsOf(
  projects: Project[],
  visibleIds: Set<string>,
  parentLocalId: string | null,
): Project[] {
  return projects.filter((p) => {
    const pid = p.parentLocalId && visibleIds.has(p.parentLocalId) ? p.parentLocalId : null;
    return pid === parentLocalId;
  });
}

/** Per-project expand/collapse state, persisted to localStorage; default open.
 * Shared key so the desktop sidebar and mobile Browse stay in sync. */
export function useProjectExpand(storageKey = 'cria:project-tree-open') {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    } catch {
      return {};
    }
  });
  const isOpen = (id: string) => open[id] ?? true;
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = { ...prev, [id]: !(prev[id] ?? true) };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore quota / private-mode failures */
      }
      return next;
    });
  return { isOpen, toggle };
}
