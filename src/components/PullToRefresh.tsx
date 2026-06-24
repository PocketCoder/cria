import { useRef, useState, useEffect, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';

const PULL_THRESHOLD = 60;
const MAX_PULL = 100;
const DAMPING = 0.5;
const START_PULL_DISTANCE = 10; // movement (px) before a gesture is classified
const LONG_PRESS_MS = 200; // matches the dnd-kit TouchSensor delay (drag-to-reorder)

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ReactNode;
}

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const isMobile = useIsMobile();
  const [state, setState] = useState<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle');
  const [pullDistance, setPullDistance] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pullDistanceRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  // The effect is gated on `isMobile` *inside* the body (not via an early
  // return before it): a `return` ahead of a hook changes the hook count when
  // the viewport crosses the 768px breakpoint and crashes React. The desktop
  // passthrough render lives after all hooks instead.
  useEffect(() => {
    if (!isMobile) return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let atTop = false;
    let pulling = false;
    let disqualified = false; // this gesture can't become a pull

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0]!.clientX;
      startY = e.touches[0]!.clientY;
      startTime = e.timeStamp;
      // Only the *starting* scroll position counts: pull fires when the touch
      // begins at the top, not when a mid-list scroll happens to reach it. This
      // is the "only after scrolling up is done" behaviour.
      atTop = scrollEl.scrollTop <= 0;
      pulling = false;
      disqualified = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || disqualified) return;
      const dx = e.touches[0]!.clientX - startX;
      const dy = e.touches[0]!.clientY - startY;

      if (!pulling) {
        // Wait for a decisive amount of movement before classifying the gesture.
        if (Math.abs(dx) < START_PULL_DISTANCE && Math.abs(dy) < START_PULL_DISTANCE) return;
        // A pull is a fresh, prompt, downward drag from the top. Disqualify
        // everything else so it doesn't fight the other gestures:
        //  - !atTop          → mid-list scroll
        //  - |dx| > |dy|     → horizontal row swipe (complete/delete)
        //  - dy <= 0         → upward drag (scrolling down through the list)
        //  - held > 200ms    → press-and-hold that dnd-kit grabs as a reorder
        if (
          !atTop ||
          Math.abs(dx) > Math.abs(dy) ||
          dy <= 0 ||
          e.timeStamp - startTime > LONG_PRESS_MS
        ) {
          disqualified = true;
          return;
        }
        pulling = true;
        startY = e.touches[0]!.clientY; // reset baseline so the pull starts at 0
      }

      e.preventDefault();
      const rawDy = e.touches[0]!.clientY - startY;
      const distance = Math.min(MAX_PULL, rawDy * DAMPING);
      pullDistanceRef.current = distance;
      setPullDistance(distance);
      setState(distance >= PULL_THRESHOLD ? 'ready' : 'pulling');
    };

    const onTouchEnd = () => {
      if (pulling) {
        if (pullDistanceRef.current >= PULL_THRESHOLD) {
          setState('refreshing');
          onRefreshRef.current().finally(() => {
            setState('idle');
            setPullDistance(0);
          });
        } else {
          setState('idle');
          setPullDistance(0);
        }
      }
      pulling = false;
      disqualified = false;
    };

    const onTouchCancel = () => {
      pulling = false;
      disqualified = false;
      pullDistanceRef.current = 0;
      setState('idle');
      setPullDistance(0);
    };

    scrollEl.addEventListener('touchstart', onTouchStart, { passive: true });
    scrollEl.addEventListener('touchmove', onTouchMove, { passive: false });
    scrollEl.addEventListener('touchend', onTouchEnd);
    scrollEl.addEventListener('touchcancel', onTouchCancel);

    return () => {
      scrollEl.removeEventListener('touchstart', onTouchStart);
      scrollEl.removeEventListener('touchmove', onTouchMove);
      scrollEl.removeEventListener('touchend', onTouchEnd);
      scrollEl.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [isMobile]);

  if (!isMobile) return <>{children}</>;

  const label =
    state === 'ready' ? 'Release to refresh' :
    state === 'refreshing' ? 'Refreshing…' :
    'Pull to refresh';

  return (
    <div style={{ overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          transform: `translateY(${Math.max(0, pullDistance)}px)`,
          transition: state === 'pulling' ? 'none' : 'transform 0.3s ease',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div
          style={{ height: 60, marginTop: -60 }}
          className="flex shrink-0 items-center justify-center gap-2 text-sm text-[var(--color-muted-foreground)]"
        >
          <RefreshCw
            className={cn('h-4 w-4', state === 'refreshing' && 'animate-spin')}
            style={{ animationDuration: state === 'refreshing' ? '0.8s' : undefined }}
          />
          <span>{label}</span>
        </div>
        <div ref={scrollRef} className={cn('min-h-0 flex-1 overflow-y-auto', isMobile && 'tab-bar-safe-bottom')}>
          {children}
        </div>
      </div>
    </div>
  );
}
