import { useState } from 'react';
import { ProjectInfoModal } from '@/features/projects/ProjectInfoModal';
import { ProjectBackgroundModal } from '@/features/projects/ProjectBackgroundModal';
import { ShareProjectModal } from '@/features/projects/ShareProjectModal';
import { SavedFilterModal } from '@/features/smart-views/SavedFilterModal';
import { useUi } from '@/stores/ui';
import {
  Calendar,
  CalendarDays,
  Star,
  Inbox,
  Search,
} from 'lucide-react';
import type { Project } from '@/domain/project';
import { NavItem } from './SidebarRows';
import {
  LabelsSection,
  ProjectsSection,
  SavedFiltersSection,
  SidebarFooter,
  type FilterModalState,
} from './SidebarSections';

/**
 * Sidebar with smart views at the top (Today / Upcoming / Labels) and
 * project CRUD below. Clicking a view updates `activeView` in the UI
 * store, which the Shell reads to decide what to render in the main pane.
 */
export function ProjectSidebar({
  showSmartViews = true,
  onOpenSearch,
  onOpenSettings,
  onOpenOutbox,
  onOpenConflicts,
  onDragMouseDown,
}: {
  showSmartViews?: boolean;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onOpenOutbox?: () => void;
  onOpenConflicts?: () => void;
  onDragMouseDown?: (e: React.MouseEvent) => void;
} = {}) {
  const activeView = useUi((s) => s.activeView);
  const setActiveView = useUi((s) => s.setActiveView);

  const [filterModal, setFilterModal] = useState<FilterModalState>(null);
  const [shareProject, setShareProject] = useState<Project | null>(null);
  const [infoProject, setInfoProject] = useState<Project | null>(null);
  const [backgroundProject, setBackgroundProject] = useState<Project | null>(null);

  return (
    <aside className="sidebar-surface flex h-full w-[var(--sidebar-width)] shrink-0 flex-col bg-[var(--color-background)]">
      {/* 44px strip under the native (overlay) traffic lights — the window drag region */}
      <div role="presentation" onMouseDown={onDragMouseDown} className="h-11 flex-none select-none" />

      {/* Search → command palette */}
      <div className="flex-none px-3 pb-3">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex w-full items-center gap-2 rounded-lg bg-[var(--color-muted)] px-2.5 py-1.5 text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <span className="text-[11px] opacity-70">⌘K</span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {/* ── Smart Views (hidden in mobile sheet — only shows projects + labels) ── */}
        {showSmartViews && (
          <div className="flex flex-col gap-1">
            <NavItem
              icon={Calendar}
              label="Today"
              isSelected={activeView?.kind === 'today'}
              onClick={() => setActiveView({ kind: 'today' })}
            />
            <NavItem
              icon={CalendarDays}
              label="Upcoming"
              isSelected={activeView?.kind === 'upcoming'}
              onClick={() => setActiveView({ kind: 'upcoming' })}
            />
            <NavItem
              icon={Inbox}
              label="Inbox"
              isSelected={activeView?.kind === 'inbox'}
              onClick={() => setActiveView({ kind: 'inbox' })}
            />
            <NavItem
              icon={Star}
              label="Favorites"
              isSelected={activeView?.kind === 'favorites'}
              onClick={() => setActiveView({ kind: 'favorites' })}
            />
          </div>
        )}

        {/* ── Saved filters (Vikunja pseudo-projects) ── */}
        {showSmartViews && (
          <SavedFiltersSection
            onNewFilter={() => setFilterModal({ mode: 'create' })}
            onEditFilter={(filter) => setFilterModal({ mode: 'edit', filter })}
          />
        )}

        {/* ── Labels ── */}
        <LabelsSection />

        <div className="my-2 border-t border-[var(--color-border)]" />

        {/* ── Projects ── */}
        <ProjectsSection onShare={setShareProject} onBackground={setBackgroundProject} onInfo={setInfoProject} />
      </nav>

      <SidebarFooter
        onOpenSettings={onOpenSettings}
        onOpenOutbox={onOpenOutbox}
        onOpenConflicts={onOpenConflicts}
      />

      {filterModal && (
        <SavedFilterModal
          existing={filterModal.mode === 'edit' ? filterModal.filter : null}
          onClose={() => setFilterModal(null)}
        />
      )}
      {infoProject && (
        <ProjectInfoModal project={infoProject} onClose={() => setInfoProject(null)} />
      )}
      {backgroundProject && (
        <ProjectBackgroundModal
          project={backgroundProject}
          onClose={() => setBackgroundProject(null)}
        />
      )}
      {shareProject && (
        <ShareProjectModal
          project={shareProject}
          onClose={() => setShareProject(null)}
        />
      )}
    </aside>
  );
}
