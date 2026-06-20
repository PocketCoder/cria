import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listTasksForProject, listTasksForProjectFiltered } from '@/db/tasks';
import { subscribe } from '@/db/bus';
import { throttledWarn } from '@/api/resilience';
import { pullTasksForProject } from '@/sync/pull';
import { parseFilterQuery } from '@/lib/filterQueryParser';
import { compileFilterAndSort } from '@/lib/filterCompiler';
import type { FilterNode } from '@/lib/filterQueryParser';
import type { SortRule } from '@/lib/sortEngine';
import type { Task } from '@/domain/task';
import type { Project } from '@/domain/project';

function astReferencesField(ast: FilterNode | null, field: string): boolean {
  if (!ast) return false;
  if (ast.type === 'clause') return ast.field === field;
  if (ast.type === 'group') {
    return ast.children.some((c) => astReferencesField(c, field));
  }
  return false;
}

function parseFilter(expr: string): {
  ast: FilterNode | null;
  hasDoneFilter: boolean;
} {
  try {
    const { ast } = parseFilterQuery(expr);
    return { ast, hasDoneFilter: astReferencesField(ast, 'done') };
  } catch {
    return { ast: null, hasDoneFilter: false };
  }
}

export function useProjectTasks(
  project: Project | null,
  filterQuery?: string,
  sortRule?: SortRule | null,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('tasks', () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
  }, [queryClient]);

  const parsed = useMemo(
    () => filterQuery ? parseFilter(filterQuery) : { ast: null, hasDoneFilter: false },
    [filterQuery],
  );

  const compiled = useMemo(
    () => compileFilterAndSort(parsed.ast, false, sortRule ?? null),
    [parsed.ast, sortRule],
  );

  return useQuery<Task[]>({
    queryKey: ['tasks', project?.localId ?? null, filterQuery, sortRule],
    queryFn: async () => {
      if (!project) return [];
      if (project.serverId != null) {
        try {
          await pullTasksForProject(project.serverId);
        } catch (err) {
          throttledWarn('queries/tasks', '[queries/tasks] pull failed, using cache:', err);
        }
      }
      if (compiled.where) {
        return listTasksForProjectFiltered(
          project.localId,
          !parsed.hasDoneFilter,
          compiled.where,
          compiled.params,
          compiled.orderBy || undefined,
        );
      }
      if (compiled.orderBy) {
        return listTasksForProjectFiltered(
          project.localId,
          !parsed.hasDoneFilter,
          undefined,
          undefined,
          compiled.orderBy,
        );
      }
      return listTasksForProject(project.localId);
    },
    enabled: project != null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
