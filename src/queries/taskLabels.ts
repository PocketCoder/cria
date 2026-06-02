import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listLabelsForTask } from '@/db/labels';
import { subscribe } from '@/db/bus';
import type { Label } from '@/domain/label';

/**
 * Returns the labels currently attached to a task. Re-runs on:
 *  - `tasks` — a pull upserts tasks AND their labels in one go;
 *  - `task_labels` — local add/remove via toggleTaskLabel notifies this
 *    topic, so the chips refresh immediately after a mutation (the
 *    detail-card label × and the actions-dropdown toggle both rely on
 *    this). Previously only `tasks` was observed, so a local toggle
 *    didn't refresh the chips until the next pull.
 */
export function useTaskLabels(taskLocalId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const inval = () =>
      void queryClient.invalidateQueries({ queryKey: ['task-labels'] });
    const unsubTasks = subscribe('tasks', inval);
    const unsubLabels = subscribe('task_labels', inval);
    return () => {
      unsubTasks();
      unsubLabels();
    };
  }, [queryClient]);

  return useQuery<Label[]>({
    queryKey: ['task-labels', taskLocalId],
    queryFn: async () => {
      if (!taskLocalId) return [];
      return listLabelsForTask(taskLocalId);
    },
    enabled: taskLocalId != null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
