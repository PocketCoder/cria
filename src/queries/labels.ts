import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listLabels } from '@/db/labels';
import { subscribe } from '@/db/bus';
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
      try {
        await pullLabels();
      } catch (err) {
        console.warn('[queries/labels] pull failed, using cache:', err);
      }
      return listLabels();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
