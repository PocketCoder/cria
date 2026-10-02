import { useCallback } from 'react';

/**
 * Stable ref callback that focuses its element when it mounts. Replaces the
 * `autoFocus` attribute (which jsx-a11y flags) with the same timing: React
 * runs ref callbacks at commit, like it does for `autoFocus`. The callback's
 * identity never changes, so re-renders don't steal focus back.
 */
export function useFocusOnMount<T extends HTMLElement>(): (el: T | null) => void {
  return useCallback((el: T | null) => {
    el?.focus();
  }, []);
}
