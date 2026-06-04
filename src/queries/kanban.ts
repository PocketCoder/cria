import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjectTasks } from '@/queries/tasks';
import { listBucketsForView, listBucketAssignmentsForView } from '@/db/buckets';
import { subscribe } from '@/db/bus';
import type { Task } from '@/domain/task';
import type { Bucket } from '@/domain/bucket';
import type { ProjectView } from '@/domain/view';

export interface KanbanColumn {
  bucket: Bucket;
  tasks: Task[];
}

export function useKanbanBoard(view: ProjectView | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('tasks', () => {
      void queryClient.invalidateQueries({ queryKey: ['kanban', view?.localId] });
    });
  }, [queryClient, view?.localId]);

  useEffect(() => {
    return subscribe('views', () => {
      void queryClient.invalidateQueries({ queryKey: ['kanban', view?.localId] });
    });
  }, [queryClient, view?.localId]);

  const { data: tasks = [] } =
    useProjectTasks(view ? { localId: view.projectLocalId, serverId: null } as any : null);

  return useQuery<KanbanColumn[]>({
    queryKey: ['kanban', view?.localId],
    queryFn: async () => {
      if (!view) return [];

      const buckets = await listBucketsForView(view.localId);
      const assignments = await listBucketAssignmentsForView(view.localId);

      // Build a map: bucketLocalId -> taskLocalIds
      const assignMap = new Map<string, string[]>();
      for (const a of assignments) {
        const existing = assignMap.get(a.bucketLocalId) ?? [];
        existing.push(a.taskLocalId);
        assignMap.set(a.bucketLocalId, existing);
      }

      // Build a map: taskLocalId -> Task
      const taskMap = new Map(tasks.map((t) => [t.localId, t]));

      // Build columns from buckets, assign tasks
      const columns: KanbanColumn[] = [];
      const assigned = new Set<string>();
      for (const b of buckets) {
        const taskIds = assignMap.get(b.localId) ?? [];
        const columnTasks: Task[] = [];
        for (const tid of taskIds) {
          const t = taskMap.get(tid);
          if (t && !t.done && !isDeleted(t)) {
            columnTasks.push(t);
            assigned.add(tid);
          }
        }
        columns.push({ bucket: b, tasks: columnTasks });
      }

      // Done tasks go to the done bucket if configured, otherwise appended
      // to the last column. Unassigned (not in any bucket) go to the first
      // bucket if there is one.
      const doneBucketServerId = view.doneBucketServerId;
      const defaultBucketServerId = view.defaultBucketServerId;

      for (const t of tasks) {
        if (assigned.has(t.localId) || isDeleted(t)) continue;
        if (t.done && doneBucketServerId) {
          // Find the done bucket by server_id -> local_id mapping
          const doneBucket = buckets.find((b) => b.serverId === doneBucketServerId);
          if (doneBucket) {
            const col = columns.find((c) => c.bucket.localId === doneBucket.localId);
            if (col) col.tasks.push(t);
            assigned.add(t.localId);
          }
        }
      }

      // Remaining tasks go to the first bucket (default) or an unassigned column
      const unassigned = tasks.filter((t) => !assigned.has(t.localId) && !isDeleted(t));
      if (unassigned.length > 0) {
        const defaultBucket = defaultBucketServerId
          ? buckets.find((b) => b.serverId === defaultBucketServerId)
          : buckets[0];
        if (defaultBucket) {
          const col = columns.find((c) => c.bucket.localId === defaultBucket.localId);
          if (col) col.tasks.push(...unassigned);
        } else if (columns.length > 0) {
          columns[0]!.tasks.push(...unassigned);
        }
      }

      return columns;
    },
    enabled: view != null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

function isDeleted(t: Task): boolean {
  // Tasks that have deleted=1 but aren't yet removed from the query
  // can appear briefly; skip them.
  return (t as any).deleted === true;
}
