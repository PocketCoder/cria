import { planReorder, type ReorderPlan } from './position';
import type { ProjectView, ViewKind } from '@/domain/view';

/** Display names for each view kind (Vikunja's web UI calls kanban "Board"). */
export const VIEW_KIND_LABELS: Record<ViewKind, string> = {
  list: 'List',
  gantt: 'Gantt',
  table: 'Table',
  kanban: 'Board',
};

/** The kinds offered when adding a view, in Vikunja's default order. */
export const VIEW_KINDS: readonly ViewKind[] = ['list', 'gantt', 'table', 'kanban'];

/**
 * Whether a project's views can be managed. Negative server ids are Vikunja
 * pseudo-projects (Favorites, saved filters) whose views aren't the user's to
 * restructure; local-only (null) and real projects are.
 */
export function canManageViews(project: { serverId: number | null }): boolean {
  return project.serverId == null || project.serverId > 0;
}

/** A view's display name: its title, else the label for its kind. */
export function viewLabel(view: Pick<ProjectView, 'title' | 'viewKind'>): string {
  return view.title || VIEW_KIND_LABELS[view.viewKind] || view.viewKind;
}

/**
 * The kind label to show beside a view's title, or null when the title
 * already says it (Vikunja's defaults are titled "List", "Kanban", …).
 */
export function viewKindHint(view: Pick<ProjectView, 'title' | 'viewKind'>): string | null {
  const kindLabel = VIEW_KIND_LABELS[view.viewKind];
  const title = view.title.trim().toLowerCase();
  if (!title || title === view.viewKind || title === kindLabel.toLowerCase()) return null;
  return kindLabel;
}

/** Title for a new view: the typed text, else the kind's label. */
export function newViewTitle(draft: string, kind: ViewKind): string {
  return draft.trim() || VIEW_KIND_LABELS[kind];
}

/**
 * Why a view can't be deleted:
 * - `last-view`: a project must keep at least one view.
 * - `placeholder`: a local default with no server counterpart; deleting it
 *   locally would just bring the server's copy back on the next pull.
 */
export type ViewDeleteBlocker = 'last-view' | 'placeholder';

/**
 * Whether `localId` may be deleted from `views` (the project's live views).
 * Returns the reason it can't, or null when it can.
 */
export function viewDeleteBlocker(
  views: readonly Pick<ProjectView, 'localId' | 'placeholder'>[],
  localId: string,
): ViewDeleteBlocker | null {
  const view = views.find((v) => v.localId === localId);
  if (!view) return null;
  if (views.length <= 1) return 'last-view';
  if (view.placeholder) return 'placeholder';
  return null;
}

/**
 * The view to switch to after deleting `deletedId`: the one below it, else the
 * one above. Null when it was the only view (or isn't in the list).
 */
export function viewAfterDelete(
  views: readonly Pick<ProjectView, 'localId'>[],
  deletedId: string,
): string | null {
  const idx = views.findIndex((v) => v.localId === deletedId);
  if (idx === -1) return null;
  return (views[idx + 1] ?? views[idx - 1])?.localId ?? null;
}

/**
 * Drag-reorder is on only when there is something to reorder and no local
 * placeholder is present: a re-index would rewrite every view's position,
 * and a placeholder's update can never be pushed.
 */
export function canReorderViews(
  views: readonly Pick<ProjectView, 'placeholder'>[],
): boolean {
  return views.length > 1 && views.every((v) => !v.placeholder);
}

export interface ViewReorder {
  /** Every view id in its new order. */
  orderedIds: string[];
  /** How to persist it: one midpoint write or a full re-index. */
  plan: ReorderPlan;
}

/**
 * Plan dropping `activeId` onto `overId`'s slot, using the same fractional
 * position strategy as task reorder (`planReorder`). `views` must be in their
 * current display order. Null when nothing moves.
 */
export function planViewReorder(
  views: readonly Pick<ProjectView, 'localId' | 'position'>[],
  activeId: string,
  overId: string,
): ViewReorder | null {
  if (activeId === overId) return null;
  const ids = views.map((v) => v.localId);
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1) return null;

  const orderedIds = [...ids];
  orderedIds.splice(from, 1);
  orderedIds.splice(to, 0, activeId);

  const positions = new Map(views.map((v) => [v.localId, v.position]));
  return {
    orderedIds,
    plan: planReorder(orderedIds, activeId, (id) => positions.get(id)),
  };
}
