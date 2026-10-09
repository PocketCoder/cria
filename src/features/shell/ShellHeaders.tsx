import { format } from 'date-fns';
import { Plus, Settings, Settings2, CloudOff, CloudUpload, CloudAlert, MoreHorizontal, SlidersHorizontal, PanelLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ActiveView } from '@/stores/ui';
import type { ProjectView } from '@/domain/view';
import { MobileViewSwitcher } from '@/features/projects/MobileViewSwitcher';
import { ViewSwitcher } from '@/features/projects/ViewSwitcher';
import { ViewFilterButton } from '@/features/projects/ViewFilterButton';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { syncStatus, type SyncCounts } from './shellLogic';

interface ViewControls {
  activeView: ActiveView | null;
  projectViews: ProjectView[];
  onSelectView: (viewLocalId: string) => void;
  /** Opens the view manager; undefined when the project's views can't be managed. */
  onManageViews: (() => void) | undefined;
}

/**
 * Sync status — surfaces what the desktop footer shows, so an iOS user can
 * actually see (and reach) a stalled outbox. Hidden when everything's fine;
 * tap opens the OutboxModal (or the ConflictModal when conflicts are the only
 * thing pending).
 */
function SyncStatusButton({
  counts,
  onOpenOutbox,
  onOpenConflicts,
}: {
  counts: SyncCounts;
  onOpenOutbox: () => void;
  onOpenConflicts: () => void;
}) {
  const status = syncStatus(counts);
  if (!status) return null;
  const Icon =
    status.icon === 'offline' ? CloudOff : status.icon === 'alert' ? CloudAlert : CloudUpload;
  const tone = status.destructive
    ? 'text-[var(--color-destructive)]'
    : 'text-[var(--color-warning-text)]';
  return (
    <button
      type="button"
      aria-label={status.label}
      title={status.label}
      onClick={() => (status.onlyConflicts ? onOpenConflicts() : onOpenOutbox())}
      className={cn('relative rounded-md p-2 transition-colors hover:bg-[var(--color-muted)]', tone)}
    >
      <Icon className="h-5 w-5" />
      {status.total > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] rounded-full bg-[var(--color-primary)] px-1 text-[10px] font-semibold leading-[1.1rem] text-[var(--color-primary-foreground)]">
          {status.total > 99 ? '99+' : status.total}
        </span>
      ) : null}
    </button>
  );
}

export function MobileHeader({
  title,
  activeView,
  projectViews,
  onSelectView,
  onManageViews,
  counts,
  onOpenOutbox,
  onOpenConflicts,
  currentViewKey,
  onOpenDisplay,
  onOpenSettings,
}: ViewControls & {
  title: string;
  counts: SyncCounts;
  onOpenOutbox: () => void;
  onOpenConflicts: () => void;
  currentViewKey: string | null | undefined;
  onOpenDisplay: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <header className="flex select-none items-center border-b border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2">
      <div className="flex flex-1 items-center gap-2">
        <h1 className="vt-title nav-title-large">
          {title}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {activeView?.kind === 'project' && (
          <MobileViewSwitcher
            views={projectViews}
            activeViewLocalId={activeView.viewLocalId ?? projectViews[0]?.localId}
            onSelect={onSelectView}
            onManage={onManageViews}
          />
        )}
        <SyncStatusButton
          counts={counts}
          onOpenOutbox={onOpenOutbox}
          onOpenConflicts={onOpenConflicts}
        />
        {currentViewKey && (
          <button
            type="button"
            aria-label="Display options"
            onClick={onOpenDisplay}
            className="rounded-md p-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        )}
        <NotificationBell />
        <button
          type="button"
          aria-label="Settings"
          onClick={onOpenSettings}
          className="-mr-1 rounded-md p-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}

export function DesktopHeader({
  title,
  sidebarCollapsed,
  onToggleSidebar,
  activeView,
  projectViews,
  onSelectView,
  onManageViews,
  currentView,
  currentViewKey,
  onOpenDisplay,
  onQuickAdd,
}: ViewControls & {
  title: string;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  currentView: ProjectView | undefined;
  currentViewKey: string | null | undefined;
  onOpenDisplay: () => void;
  onQuickAdd: () => void;
}) {
  return (
    <header
      className={cn(
        'flex flex-none flex-wrap items-end justify-between gap-x-4 gap-y-3 px-10 pb-4 pt-11',
        activeView?.kind === 'upcoming' && 'bg-[var(--color-background)]',
      )}
    >
      <div className="flex min-w-[200px] flex-1 items-end gap-3">
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Show sidebar"
            title="Show sidebar (⌘E)"
            className="mb-1.5 shrink-0 rounded-md p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            <PanelLeft className="h-[18px] w-[18px]" />
          </button>
        )}
        <div className="min-w-0 flex-1">
        <h1 className="vt-title truncate text-[32px] font-semibold leading-none tracking-[-0.035em] text-[var(--color-foreground)]">
          {title}
        </h1>
        <p className="mt-1.5 truncate text-sm text-[var(--color-muted-foreground)]">
          {format(new Date(), 'EEEE d MMMM')}
        </p>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {activeView?.kind === 'project' && (
          <ViewSwitcher
            views={projectViews}
            activeViewLocalId={activeView.viewLocalId ?? projectViews[0]?.localId}
            onSelect={onSelectView}
          />
        )}
        {activeView?.kind === 'project' && onManageViews && (
          <button
            type="button"
            onClick={onManageViews}
            aria-label="Manage views"
            title="Manage views"
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        )}
        {activeView?.kind === 'project' && currentView && (
          <ViewFilterButton view={currentView} />
        )}
        {currentViewKey && (
          <button
            type="button"
            onClick={onOpenDisplay}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filter
          </button>
        )}
        <button
          type="button"
          onClick={onQuickAdd}
          className="press inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-inverse)] px-3 py-1.5 text-xs font-medium text-[var(--color-inverse-foreground)] hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          Add task
        </button>
      </div>
    </header>
  );
}
