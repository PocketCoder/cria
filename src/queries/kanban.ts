import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjectTasks } from '@/queries/tasks';
import { listBucketsForView, listBucketAssignmentsForView } from '@/db/buckets';
import { subscribe } from '@/db/bus';
import type { Task } from '@/domain/task';
import type { Bucket, TaskBucket } from '@/domain/bucket';
import { viewFilterParams } from '@/domain/view';
import type { ProjectView } from '@/domain/view';
import type { Project } from '@/domain/project';

export interface KanbanColumn {
  bucket: Bucket;
  tasks: Task[];
  /** Per-bucket position of each task, keyed by task localId. Used by the
   *  drag-reorder handler to compute neighbour positions. */
  taskPositions: Record<string, number>;
}

/**
 * Assemble kanban columns from buckets + task→bucket assignments + tasks.
 *
 * Pure (no I/O), so the column layout is unit-tested directly. Behaviour:
 * - explicit assignments place a (non-done) task in its bucket;
 * - done tasks go to the configured done bucket, if any;
 * - everything still unplaced falls into the default (or first) bucket.
 */
export function buildKanbanColumns(
  view: ProjectView,
  buckets: Bucket[],
  assignments: Pick<TaskBucket, 'taskLocalId' | 'bucketLocalId' | 'position'>[],
  tasks: Task[],
): KanbanColumn[] {
  // Build per-bucket ordered task lists from assignments (sorted by position).
  const assignMap = new Map<string, Array<{ taskLocalId: string; position: number | null }>>();
  for (const a of assignments) {
    const arr = assignMap.get(a.bucketLocalId) ?? [];
    arr.push({ taskLocalId: a.taskLocalId, position: a.position });
    assignMap.set(a.bucketLocalId, arr);
  }
  const taskMap = new Map(tasks.map((t) => [t.localId, t]));

  const columns: KanbanColumn[] = [];
  const placed = new Set<string>();
  for (const b of buckets) {
    const colTasks: Task[] = [];
    const taskPositions: Record<string, number> = {};
    for (const { taskLocalId: tid, position } of assignMap.get(b.localId) ?? []) {
      const t = taskMap.get(tid);
      if (t && !t.done) {
        colTasks.push(t);
        placed.add(tid);
        if (position != null) taskPositions[tid] = position;
      }
    }
    columns.push({ bucket: b, tasks: colTasks, taskPositions });
  }

  // Done tasks → the done bucket (if one is configured).
  if (view.doneBucketServerId != null) {
    const doneBucket = buckets.find((b) => b.serverId === view.doneBucketServerId);
    const col = doneBucket
      ? columns.find((c) => c.bucket.localId === doneBucket.localId)
      : undefined;
    if (col) {
      for (const t of tasks) {
        if (!placed.has(t.localId) && t.done) {
          col.tasks.push(t);
          placed.add(t.localId);
        }
      }
    }
  }

  // Anything still unplaced → default (or leftmost) bucket.
  const unplaced = tasks.filter((t) => !placed.has(t.localId));
  if (unplaced.length > 0) {
    const defaultBucket =
      view.defaultBucketServerId != null
        ? buckets.find((b) => b.serverId === view.defaultBucketServerId)
        : undefined;
    const target = defaultBucket ?? buckets[0];
    if (target) {
      const col = columns.find((c) => c.bucket.localId === target.localId);
      col?.tasks.push(...unplaced);
    }
  }

  return columns;
}

/**
 * Kanban board data for a view. Tasks come from the shared `useProjectTasks`
 * query (so the board pulls on mount like the list view and stays in sync
 * with it); buckets + assignments come from a small view-scoped query.
 * Columns are derived with a `useMemo` over the *live* data — not a separate
 * query closing over a stale `tasks` snapshot — so the board reflects task
 * loads and bucket moves immediately instead of waiting for the next poll.
 */
export function useKanbanBoard(
  view: ProjectView | undefined,
  project: Project | null,
) {
  const queryClient = useQueryClient();
  const vf = view ? viewFilterParams(view) : null;
  const tasksQuery = useProjectTasks(project, vf?.filter, undefined, vf?.includeNulls ?? false);

  const bucketsQuery = useQuery<{
    buckets: Bucket[];
    assignments: TaskBucket[];
  }>({
    queryKey: ['kanban-buckets', view?.localId],
    queryFn: async () => {
      if (!view) return { buckets: [], assignments: [] };
      const [buckets, assignments] = await Promise.all([
        listBucketsForView(view.localId),
        listBucketAssignmentsForView(view.localId),
      ]);
      return { buckets, assignments };
    },
    enabled: view != null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const inval = () =>
      void queryClient.invalidateQueries({
        queryKey: ['kanban-buckets', view?.localId],
      });
    // 'views' → bucket CRUD; 'tasks' → task→bucket assignment changes.
    const unsubViews = subscribe('views', inval);
    const unsubTasks = subscribe('tasks', inval);
    return () => {
      unsubViews();
      unsubTasks();
    };
  }, [queryClient, view?.localId]);

  const tasks = tasksQuery.data ?? [];
  const bucketData = bucketsQuery.data;

  const columns = useMemo<KanbanColumn[]>(() => {
    if (!view || !bucketData) return [];
    return buildKanbanColumns(view, bucketData.buckets, bucketData.assignments, tasks);
  }, [view, bucketData, tasks]);

  return {
    columns,
    isLoading: tasksQuery.isLoading || bucketsQuery.isLoading,
    isError: tasksQuery.isError || bucketsQuery.isError,
    error: tasksQuery.error ?? bucketsQuery.error,
  };
}
