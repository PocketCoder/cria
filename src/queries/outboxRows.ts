import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDb } from '@/db';
import { subscribe } from '@/db/bus';

/** A pending operation queued for the server. */
export interface OutboxRow {
  id: number;
  entity_type: string;
  entity_local_id: string;
  op: string;
  payload: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
}

/** An operation that exhausted its retries and was parked for the user. */
export interface DeadLetterRow {
  id: number;
  entity_type: string;
  entity_local_id: string;
  op: string;
  payload: string;
  attempts: number;
  last_error: string | null;
  failed_at: string;
}

/** Return outbox rows for UI debugging */
export function useOutboxRows() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('outbox', () => {
      void queryClient.invalidateQueries({ queryKey: ['outbox-rows'] });
    });
  }, [queryClient]);

  return useQuery<OutboxRow[]>({
    queryKey: ['outbox-rows'],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<OutboxRow[]>(
        `SELECT * FROM outbox ORDER BY id ASC`,
      );
      return rows;
    },
    staleTime: Infinity,
  });
}

/** Number of operations that failed permanently (dead-lettered). */
export function useDeadLettersCount() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Dead-lettering fires notify('outbox') at the point of insertion.
    return subscribe('outbox', () => {
      void queryClient.invalidateQueries({ queryKey: ['dead-letters-count'] });
    });
  }, [queryClient]);

  return useQuery<number>({
    queryKey: ['dead-letters-count'],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM outbox_dead_letter`,
      );
      return rows[0]?.count ?? 0;
    },
    staleTime: Infinity,
  });
}

/** All dead-lettered operations, newest failure first. */
export function useDeadLetters() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return subscribe('outbox', () => {
      void queryClient.invalidateQueries({ queryKey: ['dead-letters'] });
    });
  }, [queryClient]);

  return useQuery<DeadLetterRow[]>({
    queryKey: ['dead-letters'],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<DeadLetterRow[]>(
        `SELECT * FROM outbox_dead_letter ORDER BY failed_at DESC, id DESC`,
      );
      return rows;
    },
    staleTime: Infinity,
  });
}
