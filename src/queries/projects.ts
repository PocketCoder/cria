import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listProjects } from '@/db/projects';
import { subscribe } from '@/db/bus';
import { throttledWarn } from '@/api/resilience';
import { useAuth } from '@/auth/store';
import { pullProjects } from '@/sync/pull';
import type { Project } from '@/domain/project';

const KEY = ['projects'] as const;

/**
 * Returns the locally-cached project list. Triggers a one-shot background
 * pull from the server when the hook mounts under an authenticated session
 * (TanStack Query dedupes if more than one component mounts).
 */
export function useProjects() {
  const queryClient = useQueryClient();
  const isAuthed = useAuth(
    (s) => s.status.kind === 'authenticated',
  );

  useEffect(() => {
    return subscribe('projects', () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
    });
  }, [queryClient]);

  return useQuery<Project[]>({
    queryKey: KEY,
    queryFn: async () => {
      const cached = await listProjects();
      if (!isAuthed) return cached;

      // Fire the server refresh in the background instead of gating the
      // sidebar's first render on it — a full project pull is a network
      // round-trip, and the cached list is already on disk. On success, push
      // the fresh read into the cache directly (not via notify('projects'),
      // which would invalidate this query and re-fire this same pull forever).
      void pullProjects()
        .then(() => listProjects())
        .then((fresh) => queryClient.setQueryData(KEY, fresh))
        .catch((err) => throttledWarn('queries/projects', '[queries/projects] pull failed, using cache:', err));

      return cached;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Vikunja syncs a magic "Favorites" project that aggregates favourited tasks —
 * it's a view, not a real container, so it must never be offered as a place to
 * *create* a task (you favourite a task via its isFavorite flag instead). The
 * sidebar hides it the same way.
 */
export function isFavoritesPseudoProject(p: Project): boolean {
  return p.title === 'Favorites';
}

/**
 * Like {@link useProjects} but excludes the Favorites pseudo-project — use this
 * for every "which project does this task go in?" picker. `data` is always an
 * array (never undefined) so callers can drop the `?? []` default.
 */
export function useSelectableProjects() {
  const query = useProjects();
  return {
    ...query,
    data: (query.data ?? []).filter((p) => !isFavoritesPseudoProject(p)),
  };
}
