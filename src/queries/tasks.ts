import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listTasksForProject, listTasksForProjectFiltered, listTasksFilteredAllProjects } from '@/db/tasks';
import { getSavedFilterByServerId } from '@/db/savedFilters';
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
  const queryKey = ['tasks', project?.localId ?? null, filterQuery, sortRule] as const;

  useEffect(() => {
    const unsubTasks = subscribe('tasks', () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
    const unsubFilters = subscribe('saved_filters', () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
    return () => {
      unsubTasks();
      unsubFilters();
    };
  }, [queryClient]);

  const parsed = useMemo(
    () => filterQuery ? parseFilter(filterQuery) : { ast: null, hasDoneFilter: false },
    [filterQuery],
  );

  const compiled = useMemo(
    () => compileFilterAndSort(parsed.ast, false, sortRule ?? null),
    [parsed.ast, sortRule],
  );

  const isSavedFilter = project?.serverId != null && project.serverId < -1;

  const readLocal = () => {
    if (!project) return Promise.resolve([]);
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
  };

  return useQuery<Task[]>({
    queryKey,
    queryFn: async () => {
      if (!project) return [];

      if (isSavedFilter) {
        const saved = await getSavedFilterByServerId(-project.serverId! - 1);
        const parsedSaved = saved ? parseFilter(saved.filterQuery) : { ast: null, hasDoneFilter: false };
        const compiledSaved = compileFilterAndSort(
          parsedSaved.ast,
          saved?.filterIncludeNulls ?? false,
          sortRule ?? null,
        );
        return listTasksFilteredAllProjects(
          !parsedSaved.hasDoneFilter,
          compiledSaved.where || undefined,
          compiledSaved.params,
          compiledSaved.orderBy || undefined,
        );
      }

      // Fire the server refresh in the background
      if (project.serverId != null) {
        void pullTasksForProject(project.serverId)
          .then(() => readLocal())
          .then((fresh) => queryClient.setQueryData(queryKey, fresh))
          .catch((err) => throttledWarn('queries/tasks', '[queries/tasks] pull failed, using cache:', err));
      }

      return readLocal();
    },
    enabled: project != null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
