import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listSavedFilters, type SavedFilter } from '@/db/savedFilters';
import { subscribe } from '@/db/bus';

const KEY = ['savedFilters'] as const;

/** Locally-cached saved filters (pulled by the periodic sync). */
export function useSavedFilters() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('saved_filters', () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
    });
  }, [queryClient]);

  return useQuery<SavedFilter[]>({
    queryKey: KEY,
    queryFn: listSavedFilters,
    staleTime: 30_000,
  });
}
