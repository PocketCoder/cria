import { useCallback, type MutableRefObject, type RefObject } from 'react';

/**
 * Stable ref callback that focuses its element when it mounts. Replaces the
 * `autoFocus` attribute (which jsx-a11y flags) with the same timing: React
 * runs ref callbacks at commit, like it does for `autoFocus`. The callback's
 * identity never changes, so re-renders don't steal focus back.
 *
 * Pass `shared` when the element also needs to be reachable through an
 * existing ref object; it is kept in sync with the element.
 */
export function useFocusOnMount<T extends HTMLElement>(
  shared?: RefObject<T | null>,
): (el: T | null) => void {
  return useCallback(
    (el: T | null) => {
      if (shared) (shared as MutableRefObject<T | null>).current = el;
      el?.focus();
    },
    [shared],
  );
}
