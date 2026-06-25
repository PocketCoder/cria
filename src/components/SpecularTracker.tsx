import { useEffect } from 'react';
import { isMobilePlatform } from '@/lib/platform';

/**
 * Desktop-only pointer tracker for the Liquid Glass specular sheen.
 * Listens for pointer movement across the window and sets
 * `--sheen-angle` on the document root, which `.glass-specular::after`
 * uses to position its conic-gradient highlight.
 *
 * On mobile/touch there's no hover cursor — the CSS-only
 * `glass-sheen-animate` class handles the sheen instead.
 */
export function SpecularTracker() {
  useEffect(() => {
    if (isMobilePlatform()) return;

    const onPointerMove = (e: PointerEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI) + 90;
      document.documentElement.style.setProperty('--sheen-angle', `${angle}deg`);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []);

  return null;
}
