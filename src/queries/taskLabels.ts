import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listLabelsForTask, listTaskLabelLinksForProject } from '@/db/labels';
import { subscribe } from '@/db/bus';
import type { Label } from '@/domain/label';

/**
 * Map of task→label-ids across a whole project, for the kanban filter.
 * Refreshes on `tasks` (pull mirrors labels inline) and `task_labels`
 * (local add/remove).
 */
export function useProjectTaskLabels(projectLocalId: string) {
  const queryClient = useQueryClient();
  const key = ['project-task-labels', projectLocalId] as const;

  useEffect(() => {
    const inval = () => void queryClient.invalidateQueries({ queryKey: key });
    const a = subscribe('tasks', inval);
    const b = subscribe('task_labels', inval);
    return () => {
      a();
      b();
    };
  }, [queryClient, projectLocalId]); // eslint-disable-line react-hooks/exhaustive-deps

  return useQuery<Map<string, string[]>>({
    queryKey: key,
    queryFn: () => listTaskLabelLinksForProject(projectLocalId),
    enabled: projectLocalId !== '',
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

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
