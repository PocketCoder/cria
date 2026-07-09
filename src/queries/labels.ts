import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listLabels } from '@/db/labels';
import { subscribe } from '@/db/bus';
import { throttledWarn } from '@/api/resilience';
import { useAuth } from '@/auth/store';
import { pullLabels } from '@/sync/pull';
import type { Label } from '@/domain/label';

const KEY = ['labels'] as const;

export function useLabels() {
  const queryClient = useQueryClient();
  const isAuthed = useAuth((s) => s.status.kind === 'authenticated');

  useEffect(() => {
    return subscribe('labels', () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
    });
  }, [queryClient]);

  return useQuery<Label[]>({
    queryKey: KEY,
    queryFn: async () => {
      const cached = await listLabels();
      if (!isAuthed) return cached;

      // Background refresh — see queries/projects.ts for why this doesn't
      // await the pull or notify('labels') on completion.
      void pullLabels()
        .then(() => listLabels())
        .then((fresh) => queryClient.setQueryData(KEY, fresh))
        .catch((err) => throttledWarn('queries/labels', '[queries/labels] pull failed, using cache:', err));

      return cached;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}
