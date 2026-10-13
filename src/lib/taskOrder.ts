import type { Task } from '@/domain/task';

/**
 * Reorder a cached task array so the ids in `orderedIds` lead, in that order,
 * with every other task (completed / filtered-out) kept in its existing
 * relative order after them. Used for the optimistic drag-reorder cache update
 * so a list shows the dropped order before the position write round-trips.
 */
export function reorderTasksByIds(tasks: Task[], orderedIds: string[]): Task[] {
  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  const ranked: Task[] = [];
  const rest: Task[] = [];
  for (const t of tasks) (rank.has(t.localId) ? ranked : rest).push(t);
  ranked.sort((a, b) => rank.get(a.localId)! - rank.get(b.localId)!);
  return [...ranked, ...rest];
}

/**
 * Tasks in `orderedIds` order. Tasks not yet reflected in `orderedIds` (e.g. a
 * just-synced task, before the sync effect runs) are appended so nothing
 * flashes out.
 */
export function orderTasksByIds(tasks: Task[], orderedIds: string[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.localId, t]));
  const seen = new Set<string>();
  const ordered: Task[] = [];
  for (const id of orderedIds) {
    const t = byId.get(id);
    if (t) {
      ordered.push(t);
      seen.add(id);
    }
  }
  for (const t of tasks) {
    if (!seen.has(t.localId)) ordered.push(t);
  }
  return ordered;
}
