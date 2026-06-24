import { useState, useEffect } from 'react';
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
                'tab-label text-footnote font-medium transition-colors',
                isActive(tab) ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted-foreground)]',
              )}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Projects/Labels bottom sheet — tall, searchable, with counts */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-label="Projects and labels" aria-modal="true">
          <div className="sheet-backdrop absolute inset-0" onClick={() => setSheetOpen(false)} />
          <div className="safe-bottom relative z-10 flex max-h-[88vh] min-h-[60vh] flex-col rounded-t-2xl bg-[var(--color-card)] pt-2 shadow-xl animate-[sheet-up_350ms_var(--spring-snappy)]">
            {/* Grab handle */}
            <div className="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-[var(--color-muted-foreground)]/30" />
            <ProjectPickerList onPick={() => setSheetOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
