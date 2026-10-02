import { useLayoutEffect, useRef } from 'react';

/**
 * Ref that always holds the latest `value`. Written in a layout effect (not
 * during render) so discarded/replayed renders can't leak into the ref.
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
