import { useState, useEffect } from 'react';
import { Calendar, CalendarDays, Star, Inbox, ListTodo } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUi, type ActiveView } from '@/stores/ui';
import { useIsMobile } from '@/lib/useIsMobile';
import { ProjectSidebar } from '@/features/projects/ProjectSidebar';

export function TabBar() {
  const isMobile = useIsMobile();
  const activeView = useUi((s) => s.activeView);
  const setActiveView = useUi((s) => s.setActiveView);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Close sheet when active view changes (user picked something)
  useEffect(() => {
    setSheetOpen(false);
  }, [activeView]);

  if (!isMobile) return null;

  const tabs: {
    key: string;
    icon: typeof Calendar;
    label: string;
    view: ActiveView | null;
    action?: () => void;
  }[] = [
    { key: 'today', icon: Calendar, label: 'Today', view: { kind: 'today' } },
    { key: 'upcoming', icon: CalendarDays, label: 'Upcoming', view: { kind: 'upcoming' } },
    { key: 'inbox', icon: Inbox, label: 'Inbox', view: { kind: 'inbox' } },
    { key: 'favorites', icon: Star, label: 'Favorites', view: { kind: 'favorites' } },
    { key: 'projects', icon: ListTodo, label: 'Projects', view: null, action: () => setSheetOpen(true) },
  ];

  // All tabs map to smart views (today/upcoming/inbox/favorites), keyed by
  // `kind` alone; the Projects tab has `view: null` and is never "active" (it
  // opens a sheet). Default to Today when no view is selected.
  const isActive = (tab: typeof tabs[number]) =>
    !activeView ? tab.key === 'today' : tab.view !== null && activeView.kind === tab.view.kind;

  return (
    <>
      <nav className="glass-tab-bar safe-bottom fixed inset-x-0 bottom-0 z-30 flex items-center justify-around px-2 pb-1 pt-2">
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
                'tab-item flex flex-1 flex-col items-center gap-0.5 py-1',
                isActive(tab) ? 'active' : '',
              )}
              aria-label={tab.label}
            >
              <Icon className={cn(
                'tab-icon h-5 w-5 transition-colors',
                isActive(tab) ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted-foreground)]',
              )} />
              <span className={cn(
                'tab-label text-[10px] font-medium transition-colors',
                isActive(tab) ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted-foreground)]',
              )}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Projects/Labels bottom sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-label="Projects and labels" aria-modal="true">
          <div className="sheet-backdrop absolute inset-0" onClick={() => setSheetOpen(false)} />
          <div className="safe-bottom relative z-10 max-h-[70vh] rounded-t-2xl bg-[var(--color-card)] shadow-xl animate-[sheet-up_350ms_var(--spring-snappy)]">
            {/* Grab handle */}
            <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-[var(--color-muted-foreground)]/30" />
            <div className="overflow-y-auto p-3">
              <ProjectSidebar />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
