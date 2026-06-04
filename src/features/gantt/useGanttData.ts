import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjectTasks } from '@/queries/tasks';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { listSubtaskRelationsForProject } from '@/db/relations';
import { subscribe } from '@/db/bus';
import { buildGanttTaskTree, type GanttTaskNode } from './buildGanttTaskTree';
import type { Project } from '@/domain/project';

/**
 * Gantt data: the same local task set the list view reads, assembled into a
 * parent/child tree via the project's subtask relations. Pulls on mount
 * through `useProjectTasks`; rebuilds when tasks or relations change.
 */
export function useGanttData(project: Project): {
  nodes: GanttTaskNode[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
} {
  const { data: tasks = [], isLoading, isFetching, isError, error } =
    useProjectTasks(project);
  const pendingDeletes = usePendingDeletes((s) => s.pending);
  const queryClient = useQueryClient();

  const { data: childMap = new Map<string, string[]>() } = useQuery({
    queryKey: ['subtasks', project.localId],
    queryFn: () => listSubtaskRelationsForProject(project.localId),
    staleTime: 30_000,
  });

  useEffect(
    () =>
      subscribe('tasks', () => {
        void queryClient.invalidateQueries({
          queryKey: ['subtasks', project.localId],
        });
      }),
    [queryClient, project.localId],
  );

  const nodes = useMemo(() => {
    const visible = tasks.filter((t) => !pendingDeletes[t.localId]);
    return buildGanttTaskTree(visible, childMap);
  }, [tasks, childMap, pendingDeletes]);

  return { nodes, isLoading, isFetching, isError, error };
}
