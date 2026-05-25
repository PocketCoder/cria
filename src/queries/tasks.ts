import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listTasksForProject } from '@/db/tasks';
import { subscribe } from '@/db/bus';
import { pullTasksForProject } from '@/sync/pull';
import type { Task } from '@/domain/task';
import type { Project } from '@/domain/project';

export function useProjectTasks(project: Project | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('tasks', () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
  }, [queryClient]);

  return useQuery<Task[]>({
    queryKey: ['tasks', project?.localId ?? null],
    queryFn: async () => {
      if (!project) return [];
      if (project.serverId != null) {
        try {
          await pullTasksForProject(project.serverId);
        } catch (err) {
          console.warn('[queries/tasks] pull failed, using cache:', err);
        }
      }
      return listTasksForProject(project.localId);
    },
    enabled: project != null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
