import { ViewSwitcher } from './ViewSwitcher';
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
  return (
    <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-6 py-3">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{
          background:
            project.hexColor || 'var(--color-muted-foreground)',
        }}
      />
      <h1 className="text-base font-semibold tracking-tight">
        {project.title}
      </h1>
      <div className="ml-auto">
        <ViewSwitcher
          views={views}
          activeViewLocalId={activeViewLocalId}
          onSelect={onSelectView}
        />
      </div>
    </header>
  );
}
