import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadProjectBackground } from '@/lib/projectBackgroundCache';
import { useOnline } from '@/hooks/useOnline';

/** Prefix key: invalidating it refetches every variant of the query. */
export const projectBackgroundKey = (serverId: number | null) =>
  ['project-bg', serverId] as const;

/**
 * Object URL for a project's background image, or null (none set, unsynced
 * project, or offline with nothing cached). Backed by the blob-store cache;
 * callers invalidate `projectBackgroundKey` after changing the background.
 */
export function useProjectBackground(serverId: number | null): string | null {
  const online = useOnline();
  const { data: blob } = useQuery({
    // `online` in the key so coming back online refreshes the cached copy.
    queryKey: [...projectBackgroundKey(serverId), online],
    queryFn: () => loadProjectBackground(serverId!, online),
    enabled: serverId != null && serverId > 0,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url;
}
