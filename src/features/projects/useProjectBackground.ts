import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchProjectBackground } from '@/api/projects';
import { useOnline } from '@/hooks/useOnline';

export const projectBackgroundKey = (serverId: number | null) =>
  ['project-bg', serverId] as const;

/**
 * Object URL for a project's background image, or null (none set, offline,
 * unsynced project). The query key is stable per project; callers invalidate
 * it after changing the background.
 */
export function useProjectBackground(serverId: number | null): string | null {
  const online = useOnline();
  const { data: blob } = useQuery({
    queryKey: projectBackgroundKey(serverId),
    queryFn: () => fetchProjectBackground(serverId!),
    enabled: online && serverId != null && serverId > 0,
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
