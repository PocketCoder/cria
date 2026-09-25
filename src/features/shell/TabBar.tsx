import { Calendar, CalendarDays, LayoutGrid, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
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
  const inboxCount = inboxGroups.reduce(
    (n, g) => n + g.tasks.filter((t) => !t.done).length,
    0,
  );

  // While multi-selecting, the SelectionBar replaces the tab bar.
  if (!isMobile || selecting) return null;

  const tabs: {
    key: string;
    icon: typeof Calendar;
    label: string;
    view: ActiveView | null;
  }[] = [
    { key: 'today', icon: Calendar, label: 'Today', view: { kind: 'today' } },
    { key: 'upcoming', icon: CalendarDays, label: 'Upcoming', view: { kind: 'upcoming' } },
    { key: 'browse', icon: LayoutGrid, label: 'Browse', view: { kind: 'browse' } },
    { key: 'search', icon: Search, label: 'Search', view: { kind: 'search' } },
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

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-[var(--color-border)] bg-[var(--color-card)] px-3"
      style={{ paddingTop: '8px', paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
      aria-label="Primary"
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
              'relative flex flex-1 flex-col items-center justify-center gap-1 py-0.5',
              'transition-colors',
            )}
            aria-label={tab.label}
            aria-current={active ? 'page' : undefined}
          >
            <Icon
              className={cn(
                'h-[22px] w-[22px]',
                active
                  ? 'text-[var(--color-foreground)]'
                  : 'text-[var(--color-muted-foreground)]',
              )}
              strokeWidth={active ? 2 : 1.75}
            />
            <span
              className={cn(
                'text-[10.5px] leading-none',
                active
                  ? 'font-semibold text-[var(--color-foreground)]'
                  : 'text-[var(--color-muted-foreground)]',
              )}
            >
              {tab.label}
            </span>
            {tab.key === 'browse' && inboxCount > 0 ? (
              <span className="absolute right-[calc(50%-24px)] top-0 min-w-[16px] rounded-full bg-[var(--color-inverse)] px-1 py-px text-center text-[9px] font-semibold leading-[14px] text-[var(--color-inverse-foreground)]">
                {inboxCount > 99 ? '99+' : inboxCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
