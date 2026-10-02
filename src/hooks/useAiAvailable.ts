import { useQuery } from '@tanstack/react-query';
import { aiAvailability } from '@/tauri/ai';

/**
 * Whether the on-device model can run here. AI buttons render only when this
 * is true, so unsupported devices never see a feature that can't work.
 * Re-checked every few minutes: `modelNotReady` clears once the download ends,
 * and the user may switch Apple Intelligence on while the app is open.
 */
export function useAiAvailable(): boolean {
  const { data } = useQuery({
    queryKey: ['ai-availability'],
    queryFn: aiAvailability,
    staleTime: 5 * 60_000,
  });
  return data === 'available';
}
