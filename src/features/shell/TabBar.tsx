import { useState, useEffect, useRef } from 'react';
import { Calendar, CalendarDays, Inbox, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUi, type ActiveView } from '@/stores/ui';
import { useIsMobile } from '@/lib/useIsMobile';
import { ProjectPickerList } from '@/features/projects/ProjectPickerList';

export function TabBar() {
  const isMobile = useIsMobile();
  const activeView = useUi((s) => s.activeView);
  const setActiveView = useUi((s) => s.setActiveView);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Close sheet when active view changes (user picked something)
  useEffect(() => {
    setSheetOpen(false);
  }, [activeView]);

  // ── Swipe-down-to-dismiss for the Browse drawer ──────────────────────────
  // Native (non-passive) touch listeners so we can preventDefault and stop the
  // page rubber-banding while dragging. The drag only engages when the inner
  // list is scrolled to the top, so it never fights normal scrolling. Past a
  // distance threshold the sheet animates out and unmounts; otherwise it snaps
  // back.
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ startY: 0, active: false });
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!sheetOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    setDragY(0);
    const scroller = panel.querySelector<HTMLElement>('.overflow-y-auto');

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      drag.current = { startY: e.touches[0]!.clientY, active: false };
    };
    const move = (e: TouchEvent) => {
      const dy = e.touches[0]!.clientY - drag.current.startY;
      if (!drag.current.active) {
        // Only hijack as a dismiss-drag when pulling down from the very top.
        if (dy > 4 && (!scroller || scroller.scrollTop <= 0)) drag.current.active = true;
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
      const dy = (e.changedTouches[0]?.clientY ?? drag.current.startY) - drag.current.startY;
      drag.current.active = false;
      if (dy > 110) {
        // Slide fully out, then unmount once the transition has played.
        setDragY(window.innerHeight);
        window.setTimeout(() => setSheetOpen(false), 240);
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
  }, [sheetOpen]);

  if (!isMobile) return null;

  const tabs: {
    key: string;
    icon: typeof Calendar;
    label: string;
    view: ActiveView | null;
    action?: () => void;
  }[] = [
    { key: 'inbox', icon: Inbox, label: 'Inbox', view: { kind: 'inbox' } },
    { key: 'today', icon: Calendar, label: 'Today', view: { kind: 'today' } },
    { key: 'upcoming', icon: CalendarDays, label: 'Upcoming', view: { kind: 'upcoming' } },
    { key: 'browse', icon: LayoutGrid, label: 'Browse', view: null, action: () => setSheetOpen(true) },
  ];

  // Inbox/Today/Upcoming map to smart views keyed by `kind`; Browse has
  // `view: null` and opens the projects/labels sheet (it reads as active while
  // that sheet is open, or when a project/label is the current view). Default
  // to Inbox when nothing is selected.
  const isActive = (tab: typeof tabs[number]) => {
    if (tab.key === 'browse') {
      return (
        sheetOpen ||
        activeView?.kind === 'project' ||
        activeView?.kind === 'label' ||
        activeView?.kind === 'favorites'
      );
    }
    if (!activeView) return tab.key === 'inbox';
    return tab.view !== null && activeView.kind === tab.view.kind;
  };

  return (
    <>
      <nav
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
      >
        <div className="tab-bar-dock pointer-events-auto flex w-full max-w-md items-center justify-around gap-1 rounded-[26px] px-2 py-1.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  if (tab.action) tab.action();
                  else if (tab.view) setActiveView(tab.view);
                }}
                className={cn(
                  'tab-item flex flex-1 flex-col items-center gap-0.5 rounded-[20px] py-1.5',
                  isActive(tab) ? 'active' : '',
                )}
                aria-label={tab.label}
              >
                <Icon className={cn(
                  'tab-icon h-5 w-5 transition-colors',
                  isActive(tab) ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted-foreground)]',
                )} />
                <span className={cn(
                  'tab-label text-footnote font-medium transition-colors',
                  isActive(tab) ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted-foreground)]',
                )}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Projects/Labels bottom sheet — tall, searchable, with counts */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-label="Projects and labels" aria-modal="true">
          <div className="sheet-backdrop absolute inset-0" onClick={() => setSheetOpen(false)} />
          <div
            ref={panelRef}
            className={cn(
              'safe-bottom relative z-10 flex max-h-[88vh] min-h-[60vh] flex-col rounded-t-2xl bg-[var(--color-card)] pt-2 shadow-xl',
              dragY === 0 && !drag.current.active && 'animate-[sheet-up_350ms_var(--spring-snappy)]',
            )}
            style={{
              transform: dragY ? `translateY(${dragY}px)` : undefined,
              transition: drag.current.active ? 'none' : 'transform 240ms var(--spring-snappy)',
            }}
          >
            {/* Grab handle */}
            <div className="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-[var(--color-muted-foreground)]/30" />
            <ProjectPickerList onPick={() => setSheetOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
