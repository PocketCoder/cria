import { useCallback, useState } from 'react';

/**
 * Optimistic id order for drag-reorder. Returns `base` until `setOrder` is
 * called; the override is dropped as soon as `base` changes identity (i.e. the
 * query refetched), so the server order wins again without a sync effect.
 * `base` must be memoised by the caller.
 */
export function useOptimisticOrder(base: string[]): [string[], (order: string[]) => void] {
  const [override, setOverride] = useState<{ base: string[]; order: string[] } | null>(null);
  const items = override && override.base === base ? override.order : base;
  const setOrder = useCallback((order: string[]) => setOverride({ base, order }), [base]);
  return [items, setOrder];
}
