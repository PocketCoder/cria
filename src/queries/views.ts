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
 * Seeds the four local default views **first** so the view UI always has
 * something to render immediately — no waiting for the server round-trip.
 * Then, best-effort, refreshes from the server (mirrors how
 * `useProjectTasks` triggers `pullTasksForProject`). When server views
 * arrive, `replaceViewsForProjectFromServer` upgrades the defaults in
 * place (soft-deletes placeholders, upserts the real ones).
 *
 * On a fresh install with no network, the defaults render: List, Gantt,
 * Table, Kanban. On cellular with a slow link, the user sees the defaults
 * in <1 ms instead of staring at "No views available" for 20 s.
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

      // Seed local defaults first so the view pane always has something.
      // Server views will replace these via replaceViewsForProjectFromServer.
      await createDefaultViews(projectLocalId);

      // Best-effort server refresh — don't block the UI on it.
      try {
        await pullViewsForProjectLocal(projectLocalId);
      } catch (err) {
        console.warn('[queries/views] pull failed, using cache:', err);
      }

      return listViewsForProject(projectLocalId);
    },
    enabled: projectLocalId !== '',
    staleTime: 30_000,
  });
}
