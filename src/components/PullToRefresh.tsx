import { useRef, useState, useEffect, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';

const PULL_THRESHOLD = 60;
const MAX_PULL = 100;
const DAMPING = 0.5;
const START_PULL_DISTANCE = 10; // minimum downward movement before pull starts; avoids conflict with DnD long-press grab

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

    let startY = 0;
    let pulling = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startY = e.touches[0]!.clientY;
      pulling = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const dy = e.touches[0]!.clientY - startY;

      if (!pulling && scrollEl.scrollTop <= 0 && dy > START_PULL_DISTANCE) {
        pulling = true;
        startY = e.touches[0]!.clientY;
      }

      if (pulling) {
        e.preventDefault();
        const rawDy = e.touches[0]!.clientY - startY;
        const distance = Math.min(MAX_PULL, rawDy * DAMPING);
        pullDistanceRef.current = distance;
        setPullDistance(distance);
        setState(distance >= PULL_THRESHOLD ? 'ready' : 'pulling');
      }
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
    };

    const onTouchCancel = () => {
      pulling = false;
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
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
