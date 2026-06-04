import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchCurrentUser } from '@/api/user';
import { getCachedUser, upsertUser } from '@/db/user';
import { throttledWarn } from '@/api/resilience';
import { subscribe } from '@/db/bus';
import type { User } from '@/domain/user';
import { useAuth } from '@/auth/store';

const KEY = ['user'] as const;

/**
 * Returns the locally-cached user. When authenticated, kicks off a
 * background refresh from the server; if that fails the cached value
 * remains the source of truth.
 */
export function useCurrentUser() {
  const queryClient = useQueryClient();
  const status = useAuth((s) => s.status);
  const isAuthed = status.kind === 'authenticated';

  useEffect(() => {
    return subscribe('user', () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
    });
  }, [queryClient]);

  return useQuery<User | null>({
    queryKey: KEY,
    queryFn: async () => {
      const cached = await getCachedUser();
      if (!isAuthed) return cached;
      try {
        const fresh = await fetchCurrentUser();
        await upsertUser(fresh);
        return fresh;
      } catch (err) {
        throttledWarn('queries/user', '[queries/user] refresh failed:', err);
        return cached;
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
