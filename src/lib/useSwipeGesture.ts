import { useRef, useState, useEffect } from 'react';

export const SWIPE_COMPLETE_THRESHOLD = 80;
export const SWIPE_DELETE_THRESHOLD = 160;
const DIRECTION_RATIO = 1.5;

interface UseSwipeGestureOptions {
  /** Called when the complete threshold is met on a left-to-right swipe */
  onComplete?: () => void;
  /** Called when the delete threshold is met on a left-to-right swipe */
  onDelete?: () => void;
  disabled?: boolean;
}

interface UseSwipeGestureReturn<T> {
  ref: React.RefObject<T | null>;
  isSwiping: boolean;
  /** Current translateX value (0..160), tracking a left-to-right swipe. */
  swipeOffset: number;
}

export function useSwipeGesture<T extends HTMLElement>({
  onComplete,
  onDelete,
  disabled = false,
}: UseSwipeGestureOptions): UseSwipeGestureReturn<T> {
  const ref = useRef<T>(null);
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const onCompleteRef = useRef(onComplete);
  const onDeleteRef = useRef(onDelete);
  const swipeOccurredRef = useRef(false);

  onCompleteRef.current = onComplete;
  onDeleteRef.current = onDelete;

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;

    let startX = 0;
    let startY = 0;
    let translateX = 0;
    let swiping = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      swipeOccurredRef.current = false;
      startX = e.touches[0]!.clientX;
      startY = e.touches[0]!.clientY;
      translateX = 0;
      swiping = false;
      el.style.transition = 'none';
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const dx = e.touches[0]!.clientX - startX;
      const dy = e.touches[0]!.clientY - startY;

      // Activate on any horizontal gesture that's predominantly horizontal
      if (!swiping && Math.abs(dx) > Math.abs(dy) * DIRECTION_RATIO) {
        swiping = true;
        setIsSwiping(true);
      }

      if (swiping) {
        e.preventDefault();
        translateX = Math.max(0, Math.min(SWIPE_DELETE_THRESHOLD, dx));
        el.style.transform = `translateX(${translateX}px)`;
        setSwipeOffset(translateX);
      }
    };

    const onTouchEnd = () => {
      if (swiping) {
        swipeOccurredRef.current = true;
        const dist = Math.abs(translateX);
        if (dist >= SWIPE_DELETE_THRESHOLD) {
          onDeleteRef.current?.();
        } else if (dist >= SWIPE_COMPLETE_THRESHOLD) {
          onCompleteRef.current?.();
        }
        requestAnimationFrame(() => {
          if (!el.isConnected) return;
          el.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          el.style.transform = 'translateX(0)';
        });
        setTimeout(() => {
          swipeOccurredRef.current = false;
          setSwipeOffset(0);
        }, 300);
      }
      swiping = false;
      setIsSwiping(false);
    };

    const onClick = (e: MouseEvent) => {
      if (swipeOccurredRef.current) {
        e.stopPropagation();
        swipeOccurredRef.current = false;
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('click', onClick);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('click', onClick);
    };
  }, [disabled]);

  return { ref, isSwiping, swipeOffset };
}
