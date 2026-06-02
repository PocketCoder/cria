import { useQuery } from '@tanstack/react-query';
import { getAuthSnapshot } from '@/auth/store';
import { probeServer } from '@/api/client';

export function useServerVersion() {
  return useQuery<string | null>({
    queryKey: ['server-version'],
    queryFn: async () => {
      const { serverUrl } = getAuthSnapshot();
      if (!serverUrl) return null;
      const { version } = await probeServer(serverUrl);
      return version;
    },
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
