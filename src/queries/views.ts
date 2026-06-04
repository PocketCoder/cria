import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listViewsForProject, createDefaultViews } from '@/db/views';
import { pullViewsForProjectLocal } from '@/sync/pull';
import { subscribe } from '@/db/bus';
import type { ProjectView } from '@/domain/view';

function viewKey(projectLocalId: string) {
  return ['views', projectLocalId] as const;
}

/**
 * Returns the views for a project.
 *
 * On mount it refreshes from the server (mirrors how `useProjectTasks`
 * triggers `pullTasksForProject`), then reads the local mirror. If the
 * project still has no views — offline, or a brand-new local project that
 * hasn't synced — it seeds the four local default views so the view UI
 * always has something to render.
 *
 * Subscribes to the 'views' bus to refresh on mutations.
 */
export function useProjectViews(projectLocalId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('views', () => {
      void queryClient.invalidateQueries({ queryKey: viewKey(projectLocalId) });
    });
  }, [queryClient, projectLocalId]);

  return useQuery<ProjectView[]>({
    queryKey: viewKey(projectLocalId),
    queryFn: async () => {
      if (!projectLocalId) return [];
      try {
        await pullViewsForProjectLocal(projectLocalId);
      } catch (err) {
        console.warn('[queries/views] pull failed, using cache:', err);
      }
      const views = await listViewsForProject(projectLocalId);
      if (views.length > 0) return views;
      return createDefaultViews(projectLocalId);
    },
    enabled: projectLocalId !== '',
    staleTime: 30_000,
  });
}
