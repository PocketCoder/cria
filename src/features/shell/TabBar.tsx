import { useEffect, useRef } from 'react';
import { Calendar, CalendarDays, LayoutGrid, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { nativeGlass } from '@/tauri/glass';
import { useNativeTabBar } from './useNativeTabBar';
import { useUi, type ActiveView } from '@/stores/ui';
import { useIsMobile } from '@/lib/useIsMobile';
import { useDisplay } from '@/stores/display';
import { useInboxTasks } from '@/queries/smartViews';

export function TabBar() {
  const isMobile = useIsMobile();
  const activeView = useUi((s) => s.activeView);
  const setActiveView = useUi((s) => s.setActiveView);
  const selecting = useDisplay((s) => s.selecting);
  const { data: inboxGroups = [] } = useInboxTasks();
  const navRef = useRef<HTMLElement>(null);
  const capsuleRef = useRef<HTMLDivElement>(null);
  const inboxCount = inboxGroups.reduce(
    (n, g) => n + g.tasks.filter((t) => !t.done).length,
    0,
  );

  const tabs: {
    key: string;
    icon: typeof Calendar;
    /** SF Symbol for the native iOS glass tab bar. */
    symbol: string;
    label: string;
    view: ActiveView | null;
  }[] = [
    { key: 'today', icon: Calendar, symbol: 'calendar', label: 'Today', view: { kind: 'today' } },
    { key: 'upcoming', icon: CalendarDays, symbol: 'calendar.badge.clock', label: 'Upcoming', view: { kind: 'upcoming' } },
    { key: 'browse', icon: LayoutGrid, symbol: 'square.grid.2x2', label: 'Browse', view: { kind: 'browse' } },
    { key: 'search', icon: Search, symbol: 'magnifyingglass', label: 'Search', view: { kind: 'search' } },
  ];

  // Browse reads as active whenever a project / label / favourites / the Browse
  // screen itself is showing. Default to Today when nothing is selected.
  const isActive = (tab: (typeof tabs)[number]) => {
    if (tab.key === 'browse') {
      return (
        activeView?.kind === 'browse' ||
        activeView?.kind === 'project' ||
        activeView?.kind === 'label' ||
        activeView?.kind === 'favorites'
      );
    }
    if (!activeView) return tab.key === 'today';
    return tab.view !== null && activeView.kind === tab.view.kind;
  };

  // iOS 26: a native Liquid Glass bar draws the tabs. This one stays mounted
  // but invisible, as the layout, state and hit-test source it mirrors.
  const native = nativeGlass() === 'tabbar';
  const badge = inboxCount > 0 ? (inboxCount > 99 ? '99+' : String(inboxCount)) : undefined;
  useNativeTabBar(
    native && isMobile && !selecting,
    navRef,
    capsuleRef,
    tabs.map((t) => ({
      key: t.key,
      label: t.label,
      symbol: t.symbol,
      active: isActive(t),
      ...(t.key === 'browse' && badge ? { badge } : {}),
    })),
    (key) => {
      const view = tabs.find((t) => t.key === key)?.view;
      if (view) setActiveView(view);
    },
  );

  // iOS WKWebView can leave the page scrolled up after the keyboard closes,
  // which strands the fixed bar mid-screen. Snap back once the keyboard is gone.
  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    const reset = () => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if (typing) return;
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
      if (vv && vv.offsetTop !== 0) window.scrollTo(0, 0);
    };
    const onFocusOut = () => setTimeout(reset, 50);
    window.addEventListener('focusout', onFocusOut);
    vv?.addEventListener('resize', reset);
    return () => {
      window.removeEventListener('focusout', onFocusOut);
      vv?.removeEventListener('resize', reset);
    };
  }, [isMobile]);

  // While multi-selecting, the SelectionBar replaces the tab bar.
  if (!isMobile || selecting) return null;

  return (
    <nav
      ref={navRef}
      className={cn('fixed inset-x-0 bottom-0 z-30 flex justify-center px-4', native && 'opacity-0')}
      style={{ paddingBottom: 'var(--tabbar-offset)' }}
      aria-label="Primary"
      aria-hidden={native || undefined}
    >
      <div
        ref={capsuleRef}
        className="flex w-full max-w-md items-center justify-around gap-1 rounded-[26px] border-[0.5px] border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 shadow-[var(--shadow-tabbar)]"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab);
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                if (tab.view) setActiveView(tab.view);
              }}
              className={cn(
                'tab-item relative flex flex-1 flex-col items-center gap-0.5 rounded-[20px] py-1.5',
                active ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted-foreground)]',
              )}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
            >
              {/* Keyed on `active` so the hop replays each time a tab activates. */}
              <span key={active ? 'on' : 'off'} className={cn('flex', active && 'tab-hop')}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[10px] font-medium leading-none transition-colors duration-200">
                {tab.label}
              </span>
              {tab.key === 'browse' && inboxCount > 0 ? (
                <span className="absolute right-[calc(50%-22px)] top-0.5 min-w-[16px] rounded-full bg-[var(--color-inverse)] px-1 py-px text-center text-[9px] font-semibold leading-[14px] text-[var(--color-inverse-foreground)]">
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
