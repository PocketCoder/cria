import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listLabelsForTask } from '@/db/labels';
import { subscribe } from '@/db/bus';
import type { Label } from '@/domain/label';

/**
 * Returns the labels currently attached to a task. Re-runs whenever
 * the `tasks` topic notifies (pulls upsert tasks AND their labels in
 * one go).
 */
export function useTaskLabels(taskLocalId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('tasks', () => {
      void queryClient.invalidateQueries({ queryKey: ['task-labels'] });
    });
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
