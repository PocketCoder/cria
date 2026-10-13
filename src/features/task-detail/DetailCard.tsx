import { useEffect, useRef, useState } from 'react';
import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import { X } from 'lucide-react';
import { useLatestRef } from '@/lib/useLatestRef';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/useIsMobile';
import { useKeyboardInset } from '@/components/quick-add/useSheetBehaviour';

/**
 * The inspector chrome: a permanent right-hand column on desktop (in-flow
 * flex item beside the list) and an iOS-style sheet on mobile. The chrome
 * strip (favourite / overflow / close) renders at the top, right-aligned.
 */
export function DetailCard({
  onClose,
  header,
  cardRef,
  children,
}: {
  onClose: () => void;
  /** `undefined`: default close button. `null`: no header strip (caller renders its own). */
  header?: React.ReactNode;
  cardRef?: React.Ref<HTMLElement>;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  // Lift the sheet above the on-screen keyboard so the field being edited stays visible.
  const keyboardInset = useKeyboardInset();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetOffset, setSheetOffset] = useState(0);
  const offsetRef = useRef(0);
  // iOS-style detents: 'large' is the default; dragging the header down once
  // settles at 'medium', again dismisses; dragging up from medium re-expands.
  const [detent, setDetent] = useState<'medium' | 'large'>('large');
  const detentRef = useRef(detent);
  detentRef.current = detent;
  const onCloseRef = useLatestRef(onClose);

  useEffect(() => {
    if (!isMobile) return;
    const el = sheetRef.current;
    if (!el) return;

    const THRESHOLD = 8;
    let startX = 0;
    let startY = 0;
    let atTop = false;
    let dragging = false;
    let decided = false;
    let inGrabZone = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0]!.clientX;
      startY = e.touches[0]!.clientY;
      atTop = el.scrollTop <= 0;
      inGrabZone = e.touches[0]!.clientY - el.getBoundingClientRect().top < 72;
      dragging = false;
      decided = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (!dragging) {
        if (decided || !atTop) return;
        const dx = e.touches[0]!.clientX - startX;
        const dy = e.touches[0]!.clientY - startY;
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        if (dy < 0 && inGrabZone && detentRef.current === 'medium' && Math.abs(dx) <= Math.abs(dy)) {
          setDetent('large');
          decided = true;
          return;
        }
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          decided = true;
          return;
        }
        dragging = true;
        decided = true;
        startY = e.touches[0]!.clientY;
      }
      e.preventDefault();
      const dy = Math.max(0, e.touches[0]!.clientY - startY);
      offsetRef.current = dy;
      setSheetOffset(dy);
    };

    const onTouchEnd = () => {
      if (!dragging) return;
      dragging = false;
      const dy = offsetRef.current;
      offsetRef.current = 0;
      setSheetOffset(0);
      if (detentRef.current === 'large' && dy > 90 && dy <= 260) setDetent('medium');
      else if (dy > 120) onCloseRef.current();
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isMobile, onCloseRef]);

  return (
    <>
      {isMobile && (
        <BackdropDismiss onDismiss={onClose} className="sheet-backdrop fixed z-40" />
      )}
      <aside
        ref={cardRef}
        // Desktop is a floating side panel, not a modal: useShortcuts suppresses
        // every shortcut while any [role="dialog"] exists, so a dialog role
        // here would kill the task shortcuts. Mobile is a modal sheet.
        role={isMobile ? 'dialog' : 'complementary'}
        aria-label="Task details"
        className={cn(
          'vt-inspector flex flex-col overflow-hidden',
          isMobile
            ? 'fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-[var(--sheet-bg)] shadow-[var(--shadow-sheet)] dark:border-t dark:border-[var(--sheet-border)] animate-[sheet-up_350ms_var(--spring-snappy)]'
            : 'relative m-4 w-[var(--inspector-width)] max-w-[calc(100%-2rem)] shrink-0 flex-col rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--shadow-inspector)] backdrop-blur-[var(--glass-blur)]',
        )}
        style={
          isMobile
            ? {
                maxHeight: detent === 'medium' ? '55dvh' : '90dvh',
                transition: 'max-height 320ms var(--spring-snappy), transform 260ms var(--spring-snappy)',
                ...(keyboardInset > 0
                  ? { bottom: keyboardInset, maxHeight: `calc(100dvh - ${keyboardInset}px - 16px)` }
                  : null),
                ...(sheetOffset > 0
                  ? { transform: `translateY(${sheetOffset}px)`, transition: 'none' }
                  : null),
              }
            : undefined
        }
      >
        <div ref={sheetRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {isMobile && (
            <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-[var(--color-muted-foreground)]/30" />
          )}
          {header === null ? null : (
            <header className="flex shrink-0 items-center justify-end px-3.5 py-[13px]">
              {header ?? (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close details"
                  className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </header>
          )}
          {children}
        </div>
      </aside>
    </>
  );
}
