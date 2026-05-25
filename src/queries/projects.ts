import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listProjects } from '@/db/projects';
import { subscribe } from '@/db/bus';
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
      try {
        await pullProjects();
      } catch (err) {
        console.warn('[queries/projects] pull failed, using cache:', err);
      }
      return listProjects();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
