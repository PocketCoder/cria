import { useCallback, useEffect, useRef } from 'react';

const GRAB_ZONE = 64; // px from the sheet's top edge where a drag may start
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.6; // px/ms
const EXIT_MS = 220;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Bottom-sheet dismissal that feels native: drag the top of the sheet down
 * (grabber and header) to follow your finger and fling it away, and every
 * other close path (button, backdrop) slides the sheet out instead of
 * unmounting it mid-frame. `onClose` runs once the exit animation ends.
 * Attach `panelRef` to the sheet panel and call `requestClose` instead of
 * `onClose` from buttons and backdrops.
 */
export function useSheetDismiss(onClose: () => void, enabled = true) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const slideOut = useCallback(() => {
    const el = panelRef.current;
    if (closingRef.current) return;
    closingRef.current = true;
    if (!el || reducedMotion()) {
      onCloseRef.current();
      return;
    }
    el.style.transition = `transform ${EXIT_MS}ms var(--spring-snappy)`;
    el.style.transform = 'translateY(100%)';
    window.setTimeout(() => onCloseRef.current(), EXIT_MS);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const el = panelRef.current;
    if (!el) return;
    let startY = 0;
    let startT = 0;
    let allowed = false;
    let active = false;
    let dy = 0;

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || closingRef.current) return;
      const t = e.touches[0]!;
      allowed = t.clientY - el.getBoundingClientRect().top < GRAB_ZONE;
      active = false;
      startY = t.clientY;
      startT = e.timeStamp;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (!allowed) return;
      const d = e.touches[0]!.clientY - startY;
      if (!active) {
        if (d < 4) return;
        active = true;
        el.style.transition = 'none';
      }
      e.preventDefault();
      dy = Math.max(0, d);
      el.style.transform = `translateY(${dy}px)`;
    };
    const end = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      const velocity = dy / Math.max(1, e.timeStamp - startT);
      if (dy > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
        slideOut();
      } else {
        el.style.transition = 'transform 260ms var(--spring-snappy)';
        el.style.transform = '';
      }
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [enabled, slideOut]);

  return { panelRef, requestClose: slideOut };
}
