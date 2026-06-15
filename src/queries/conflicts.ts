import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDb } from '@/db';
import { useEffect } from 'react';
import { subscribe } from '@/db/bus';

/** A divergence between a dirty local row and the server's version. */
export interface ConflictRow {
  id: number;
  entity_type: string;
  entity_local_id: string;
  fields: string;
  local_snapshot: string;
  remote_snapshot: string;
  detected_at: string;
  resolved_at: string | null;
}

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
      const rows = await db.select<{ count: number }[]>(`SELECT COUNT(*) as count FROM conflicts WHERE resolved_at IS NULL`);
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

  return useQuery<ConflictRow[]>({
    queryKey: ['conflicts'],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<ConflictRow[]>(`SELECT * FROM conflicts WHERE resolved_at IS NULL ORDER BY detected_at ASC`);
      return rows;
    },
    staleTime: Infinity,
  });
}
