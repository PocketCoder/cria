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
      className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-4"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
      aria-label="Primary"
    >
      <div className="flex w-full max-w-md items-center justify-around gap-1 rounded-[26px] border-[0.5px] border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 shadow-[var(--shadow-tabbar)]">
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
                  {inboxCount > 99 ? '99+' : inboxCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
