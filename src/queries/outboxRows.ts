import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDb } from '@/db';
import { subscribe } from '@/db/bus';

/** Return outbox rows for UI debugging */
export function useOutboxRows() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('outbox', () => {
      void queryClient.invalidateQueries({ queryKey: ['outbox-rows'] });
    });
  }, [queryClient]);

  return useQuery<any[]>({
    queryKey: ['outbox-rows'],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<any[]>(`SELECT * FROM outbox ORDER BY id ASC`);
      return rows;
    },
    staleTime: Infinity,
  });
}
