import { toCalendarDate } from '@/lib/dateFormat';
import { parseQuickAdd } from '@/lib/quickAddParser';
import type { KanbanColumn } from '@/queries/kanban';
import type { Bucket, TaskBucket } from '@/domain/bucket';
import type { ProjectView } from '@/domain/view';
import type { Task, TaskInput } from '@/domain/task';

/**
 * Optimistically rewrite the kanban assignments so the target bucket's cards
 * follow `orderedTaskIds` exactly. buildKanbanColumns derives each column's
 * order from the assignment array order (not the numeric position), so a
 * positional rewrite reflects the drop immediately in SortableContext — even
 * when positions are still colliding (all 0) before the DB re-index lands.
 *
 * Any prior assignment for the moved/target tasks in this view is dropped and
 * re-added under `targetBucketId`, so a cross-bucket move also clears the card
 * from its old column. Index-based positions keep the optimistic entries
 * self-consistent until the refetch replaces them with the persisted spread.
 */
export function applyBucketOrder(
  assignments: TaskBucket[],
  viewLocalId: string,
  targetBucketId: string,
  orderedTaskIds: string[],
): TaskBucket[] {
  const moving = new Set(orderedTaskIds);
  const rest = assignments.filter(
    (a) => !(a.viewLocalId === viewLocalId && moving.has(a.taskLocalId)),
  );
  const reordered: TaskBucket[] = orderedTaskIds.map((taskLocalId, i) => ({
    taskLocalId,
    viewLocalId,
    bucketLocalId: targetBucketId,
    position: (i + 1) * 1024,
  }));
  return [...rest, ...reordered];
}

export function findSourceColumn(
  taskId: string,
  columns: KanbanColumn[],
): KanbanColumn | undefined {
  return columns.find((col) => col.tasks.some((t) => t.localId === taskId));
}

export function findTaskInColumns(
  taskId: string,
  columns: KanbanColumn[],
): Task | undefined {
  for (const col of columns) {
    const t = col.tasks.find((t) => t.localId === taskId);
    if (t) return t;
  }
  return undefined;
}

export function formatShortDate(iso: string): string {
  try {
    const d = toCalendarDate(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/** A limit draft ("3", "", "abc", "-2") to a non-negative integer. */
export function parseBucketLimit(draft: string): number {
  return Math.max(0, parseInt(draft, 10) || 0);
}

/** Whether a bucket is the view's done / default bucket. */
export function bucketRoles(
  bucket: Pick<Bucket, 'serverId'>,
  view: Pick<ProjectView, 'doneBucketServerId' | 'defaultBucketServerId'>,
): { isDone: boolean; isDefault: boolean } {
  return {
    isDone: bucket.serverId != null && view.doneBucketServerId === bucket.serverId,
    isDefault: bucket.serverId != null && view.defaultBucketServerId === bucket.serverId,
  };
}

/** WIP limits are advisory: this only drives the count highlight. */
export function isAtLimit(limit: number, taskCount: number): boolean {
  return limit > 0 && taskCount >= limit;
}

/**
 * Task input for the column's inline "Add a task" box, running the quick-add
 * parser for title / due date / priority. Null for a blank title. Label
 * tokens are returned separately so the caller can apply them after create.
 */
export function buildKanbanTaskInput(
  rawTitle: string,
  projectLocalId: string,
): { input: TaskInput; labelTitles: string[] } | null {
  const trimmed = rawTitle.trim();
  if (!trimmed) return null;
  const parsed = parseQuickAdd(trimmed);
  return {
    input: {
      title: parsed.title || trimmed,
      projectLocalId,
      dueDate: parsed.dueDate ?? undefined,
      priority: parsed.priority ?? undefined,
    },
    labelTitles: parsed.labelTitles,
  };
}
