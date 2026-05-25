import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDb } from '@/db';
import { subscribe } from '@/db/bus';

export function useOutboxCount() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('outbox', () => {
      void queryClient.invalidateQueries({ queryKey: ['outbox-count'] });
    });
  }, [queryClient]);

  return useQuery<number>({
    queryKey: ['outbox-count'],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM outbox`
      );
      return rows[0]?.count ?? 0;
    },
    staleTime: Infinity,
  });
}
