import { useEffect, useState } from 'react';

/**
 * Layout breakpoint hook. Returns true on narrow viewports (≤768px) — which is
 * every iPhone in portrait, but also a narrow desktop window. Layout keys off
 * width rather than the OS (see `isMobilePlatform` for capability gating) so
 * the responsive shell also benefits resized desktop windows and the iOS
 * Simulator reports honestly.
 */
const MOBILE_QUERY = '(max-width: 768px)';

function matches(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(MOBILE_QUERY).matches
  );
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(matches);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    // Sync once in case the media state changed between render and effect.
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
