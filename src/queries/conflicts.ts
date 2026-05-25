import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDb } from '@/db';
import { useEffect } from 'react';
import { subscribe } from '@/db/bus';

/** Returns the number of unresolved conflicts */
export function useConflictsCount() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('conflicts', () => {
      void queryClient.invalidateQueries({ queryKey: ['conflicts-count'] });
    });
  }, [queryClient]);

  return useQuery<number>({
    queryKey: ['conflicts-count'],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<any[]>(`SELECT COUNT(*) as count FROM conflicts WHERE resolved_at IS NULL`);
      return rows[0]?.count ?? 0;
    },
    staleTime: Infinity,
  });
}

/** Returns all unresolved conflicts */
export function useConflicts() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('conflicts', () => {
      void queryClient.invalidateQueries({ queryKey: ['conflicts'] });
    });
  }, [queryClient]);

  return useQuery<any[]>({
    queryKey: ['conflicts'],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<any[]>(`SELECT * FROM conflicts WHERE resolved_at IS NULL ORDER BY detected_at ASC`);
      return rows;
    },
    staleTime: Infinity,
  });
}
