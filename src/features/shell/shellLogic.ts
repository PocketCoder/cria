import type { ActiveView } from '@/stores/ui';

/** Header title for the active view. */
export function viewTitle(
  activeView: ActiveView | null,
  projects: { localId: string; title: string }[],
): string {
  if (!activeView) return 'Cria';
  switch (activeView.kind) {
    case 'today': return 'Today';
    case 'upcoming': return 'Upcoming';
    case 'inbox': return 'Inbox';
    case 'favorites': return 'Favorites';
    case 'search': return 'Search';
    case 'browse': return 'Browse';
    case 'label':
      return 'Label';
    case 'project': {
      const proj = projects.find((p) => p.localId === activeView.localId);
      return proj?.title ?? 'Project';
    }
  }
}

/** The stored view id if it still exists, else the project's first view. */
export function resolveInitialViewId(
  stored: string | null,
  views: { localId: string }[],
): string {
  return stored && views.some((v) => v.localId === stored) ? stored : views[0]!.localId;
}

/** `vikunja://task/<id>` or `vikunja://project/<id>`. */
export function parseDeepLink(url: string): { type: 'task' | 'project'; serverId: number } | null {
  const matches = url.match(/vikunja:\/\/(task|project)\/(\d+)/);
  if (!matches) return null;
  const [, type, serverIdStr] = matches;
  return { type: type as 'task' | 'project', serverId: parseInt(serverIdStr!, 10) };
}

export interface SyncCounts {
  isOnline: boolean;
  outboxCount: number;
  deadLetterCount: number;
  conflictCount: number;
}

export interface SyncStatus {
  icon: 'offline' | 'alert' | 'upload';
  destructive: boolean;
  onlyConflicts: boolean;
  total: number;
  label: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Mobile header sync indicator; null when everything is fine. */
export function syncStatus({
  isOnline,
  outboxCount,
  deadLetterCount,
  conflictCount,
}: SyncCounts): SyncStatus | null {
  const needsAttention = !isOnline || outboxCount > 0 || deadLetterCount > 0 || conflictCount > 0;
  if (!needsAttention) return null;
  const onlyConflicts = conflictCount > 0 && outboxCount === 0 && deadLetterCount === 0 && isOnline;
  const icon = !isOnline
    ? 'offline'
    : deadLetterCount > 0 || conflictCount > 0
      ? 'alert'
      : 'upload';
  const label = !isOnline
    ? outboxCount > 0 ? `Offline — ${outboxCount} saved locally` : 'Offline'
    : deadLetterCount > 0
      ? `${deadLetterCount} ${plural(deadLetterCount, 'change', 'changes')} wouldn't send`
      : outboxCount > 0
        ? `Sending ${outboxCount} ${plural(outboxCount, 'change', 'changes')}…`
        : `${conflictCount} ${plural(conflictCount, 'conflict', 'conflicts')}`;
  return {
    icon,
    destructive: !isOnline || deadLetterCount > 0,
    onlyConflicts,
    total: outboxCount + deadLetterCount + conflictCount,
    label,
  };
}

/** The active project, the resolved view id and its view (first view as default). */
export function resolveCurrentProjectView<
  P extends { localId: string },
  V extends { localId: string },
>(activeView: ActiveView | null, projects: P[], projectViews: V[]): { project: P | undefined; view: V | undefined } {
  if (activeView?.kind !== 'project') return { project: undefined, view: undefined };
  const project = projects.find((p) => p.localId === activeView.localId);
  const viewLocalId = activeView.viewLocalId ?? projectViews[0]?.localId;
  const view = viewLocalId ? projectViews.find((v) => v.localId === viewLocalId) : undefined;
  return { project, view };
}

/** The FAB hides while a full-screen overlay (detail, search, photo, quick-add) owns the screen. */
export function showMobileFab(o: {
  isMobile: boolean;
  hasSelectedTask: boolean;
  mobileSearchOpen: boolean;
  photoCaptureOpen: boolean;
  quickAddOpen: boolean;
}): boolean {
  return (
    o.isMobile &&
    !o.hasSelectedTask &&
    !o.mobileSearchOpen &&
    !o.photoCaptureOpen &&
    !o.quickAddOpen
  );
}
