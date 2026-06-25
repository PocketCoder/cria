import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDb } from '@/db';
import { subscribe } from '@/db/bus';
import { useOutboxCount } from '@/queries/outbox';
import { useDeadLettersCount } from '@/queries/outboxRows';
import { useConflictsCount } from '@/queries/conflicts';

export function useLastSyncTime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('sync_state', () => {
      void queryClient.invalidateQueries({ queryKey: ['last-sync-time'] });
    });
  }, [queryClient]);

  return useQuery<Date | null>({
    queryKey: ['last-sync-time'],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<Record<string, string | null>[]>(
        `SELECT tasks_synced_at, projects_synced_at, labels_synced_at,
                views_synced_at, buckets_synced_at
           FROM sync_state WHERE id = 1 LIMIT 1`,
      );
      const row = rows[0];
      if (!row) return null;
      const timestamps = [
        row.tasks_synced_at,
        row.projects_synced_at,
        row.labels_synced_at,
        row.views_synced_at,
        row.buckets_synced_at,
      ]
        .filter((t): t is string => t !== null)
        .map((t) => new Date(t));
      if (timestamps.length === 0) return null;
      return new Date(Math.max(...timestamps.map((d) => d.getTime())));
    },
    staleTime: Infinity,
  });
}

/**
 * Combined sync health — single hook a future settings / debug page can
 * call to get all sync-related state at once.
 */
export function useSyncHealth() {
  const { data: lastSync } = useLastSyncTime();
  const { data: outboxCount = 0 } = useOutboxCount();
  const { data: deadLetterCount = 0 } = useDeadLettersCount();
  const { data: conflictCount = 0 } = useConflictsCount();

  return {
    lastSync: lastSync ?? null,
    outboxCount,
    deadLetterCount,
    conflictCount,
  };
}
