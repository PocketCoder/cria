import { useEffect, useRef, useState } from 'react';

/** Freeze the background while the sheet is open so it stays static beneath
 * the overlay instead of scrolling/shifting. */
export function useBodyScrollLock(): void {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
}

/**
 * Swipe-down-to-dismiss. Same gesture as the Browse drawer, but the listeners
 * only engage when the touch *starts* in the top grab zone (the handle +
 * Task-name row, ~84px tall). Lower regions host the form inputs / popover
 * chip row and would fight typing or picker scrolls if drag hijacked them.
 */
export function useSheetDrag(isMobile: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ startY: 0, active: false, allowed: false });
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!isMobile) return;
    const panel = panelRef.current;
    if (!panel) return;

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const rect = panel.getBoundingClientRect();
      drag.current = {
        startY: t.clientY,
        active: false,
        allowed: t.clientY - rect.top < 84,
      };
    };
    const move = (e: TouchEvent) => {
      if (!drag.current.allowed) return;
      const dy = e.touches[0]!.clientY - drag.current.startY;
      if (!drag.current.active) {
        if (dy > 4) drag.current.active = true;
        else return;
      }
      if (dy <= 0) {
        setDragY(0);
        return;
      }
      e.preventDefault();
      setDragY(dy);
    };
    const end = (e: TouchEvent) => {
      if (!drag.current.active) return;
      const dy =
        (e.changedTouches[0]?.clientY ?? drag.current.startY) -
        drag.current.startY;
      drag.current.active = false;
      if (dy > 110) {
        setDragY(window.innerHeight);
        window.setTimeout(onClose, 240);
      } else {
        setDragY(0);
      }
    };

    panel.addEventListener('touchstart', start, { passive: true });
    panel.addEventListener('touchmove', move, { passive: false });
    panel.addEventListener('touchend', end, { passive: true });
    panel.addEventListener('touchcancel', end, { passive: true });
    return () => {
      panel.removeEventListener('touchstart', start);
      panel.removeEventListener('touchmove', move);
      panel.removeEventListener('touchend', end);
      panel.removeEventListener('touchcancel', end);
    };
  }, [isMobile, onClose]);

  return { panelRef, drag, dragY };
}

/**
 * Lift the bottom sheet above the on-screen keyboard. iOS overlays the
 * keyboard without resizing the layout viewport, but visualViewport.height
 * shrinks — the difference is the keyboard inset. No-op where unsupported.
 */
export function useKeyboardInset(): number {
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardInset(inset > 24 ? inset : 0);
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, []);
  return keyboardInset;
}

export function useEscapeKey(onClose: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
}
