import type { Project } from '@/domain/project';

export const PROJECT_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#78716c', '#000000',
];

export function timeAgo(d: Date, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/**
 * Projects shown in the tree. Negative server ids are Vikunja pseudo-projects:
 * -1 Favorites (also filtered by title for rows pulled before the sync-side
 * guard), < -1 saved filters (rendered in the Filters section, not the tree).
 */
export function visibleProjectList(projects: Project[]): Project[] {
  return projects.filter(
    (p) => (p.serverId == null || p.serverId > 0) && p.title !== 'Favorites',
  );
}

/**
 * The position for the project dropped at `dropIndex` (midpoint of its new
 * neighbours), or null when the drop is a no-op / the dragged id is unknown.
 */
export function computeDropPosition(
  visible: Project[],
  draggedId: string,
  dropIndex: number,
): number | null {
  const fromIndex = visible.findIndex((p) => p.localId === draggedId);
  if (fromIndex === -1 || fromIndex === dropIndex) return null;

  const reordered = [...visible];
  const removed = reordered.splice(fromIndex, 1);
  if (removed.length === 0) return null;
  const item = removed[0]!;
  reordered.splice(dropIndex, 0, item);

  const before: Project | undefined = reordered[dropIndex - 1];
  const after: Project | undefined = reordered[dropIndex + 1];
  const beforePos: number = before?.position ?? 0;
  const afterPos: number = after?.position ?? (beforePos + 2048);
  return (beforePos + afterPos) / 2;
}

export interface SyncLineInput {
  online: boolean;
  outboxCount: number;
  deadLetterCount: number;
  conflictCount: number;
  lastSync: Date | null | undefined;
}

export interface SyncLine {
  dot: string;
  text: string;
  action: string | null;
  /** Which modal a click opens, if any. */
  target: 'outbox' | 'conflicts' | null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Sidebar footer sync line. Priority: offline > dead letters > conflicts >
 * draining outbox > idle.
 */
export function computeSyncLine(i: SyncLineInput, now: number = Date.now()): SyncLine {
  if (!i.online) {
    return {
      dot: 'bg-[var(--color-warning)]',
      text: i.outboxCount > 0 ? `Offline — ${i.outboxCount} saved locally` : 'Offline',
      action: null,
      target: 'outbox',
    };
  }
  if (i.deadLetterCount > 0) {
    return {
      dot: 'bg-[var(--color-destructive)]',
      text: `${i.deadLetterCount} ${plural(i.deadLetterCount, 'change', 'changes')} wouldn't send`,
      action: 'Review',
      target: 'outbox',
    };
  }
  if (i.conflictCount > 0) {
    return {
      dot: 'bg-[var(--color-destructive)]',
      text: `${i.conflictCount} ${plural(i.conflictCount, 'conflict', 'conflicts')}`,
      action: 'Resolve',
      target: 'conflicts',
    };
  }
  if (i.outboxCount > 0) {
    return {
      dot: 'bg-[var(--color-primary)]',
      text: `Sending ${i.outboxCount} ${plural(i.outboxCount, 'change', 'changes')}…`,
      action: null,
      target: 'outbox',
    };
  }
  return {
    dot: 'bg-[var(--color-success)]',
    text: i.lastSync ? `All synced · ${timeAgo(i.lastSync, now)}` : 'All synced',
    action: null,
    target: null,
  };
}
