import { useRef } from 'react';

/**
 * Long-press (touch) + right-click (desktop) → one callback, for opening a
 * task's action sheet. Movement past a small threshold cancels the press so it
 * never fights the row's horizontal swipe gesture or vertical scrolling.
 *
 * `didLongPress()` lets the row suppress the click that fires after a
 * long-press touchend (otherwise it would also open the detail pane).
 */
export function useLongPress(onLongPress: () => void, delay = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return {
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (!t) return;
        start.current = { x: t.clientX, y: t.clientY };
        fired.current = false;
        clear();
        timer.current = setTimeout(() => {
          fired.current = true;
          onLongPress();
        }, delay);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (!t || !start.current) return;
        if (Math.abs(t.clientX - start.current.x) > 10 || Math.abs(t.clientY - start.current.y) > 10) {
          clear();
        }
      },
      onTouchEnd: clear,
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        fired.current = true;
        onLongPress();
      },
    },
    /** True if the last interaction was a long-press (consume + reset). */
    consumeLongPress: () => {
      const v = fired.current;
      fired.current = false;
      return v;
    },
  };
}
