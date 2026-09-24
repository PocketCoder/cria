import { ViewSwitcher } from './ViewSwitcher';
import { ViewFilterButton } from './ViewFilterButton';
import { useIsMobile } from '@/lib/useIsMobile';
import type { Project } from '@/domain/project';
import type { ProjectView } from '@/domain/view';

interface ProjectHeaderProps {
  project: Project;
  views: ProjectView[];
  activeViewLocalId: string | undefined;
  onSelectView: (viewLocalId: string) => void;
}

export function ProjectHeader({
  project,
  views,
  activeViewLocalId,
  onSelectView,
}: ProjectHeaderProps) {
  const isMobile = useIsMobile();
  const activeView = views.find((v) => v.localId === activeViewLocalId);
  // On mobile the project title lives in the app header and view-switching is a
  // header action (MobileViewSwitcher), so this desktop chrome row is hidden.
  if (isMobile) return null;
  return (
    <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-6 py-3">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{
          background: project.hexColor || 'var(--color-muted-foreground)',
        }}
      />
      <h1 className="text-base font-semibold tracking-tight">
        {project.title}
      </h1>
      <div className="ml-auto flex items-center gap-1">
        {/* Saved-filter pseudo-projects are themselves a filter — no view filter. */}
        {activeView && (project.serverId == null || project.serverId > 0) && (
          <ViewFilterButton key={activeView.localId} view={activeView} />
        )}
        <ViewSwitcher
          views={views}
          activeViewLocalId={activeViewLocalId}
          onSelect={onSelectView}
        />
      </div>
    </header>
  );
}
