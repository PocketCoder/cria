import { lazy, Suspense } from 'react';
import type { ActiveView } from '@/stores/ui';
import type { Project } from '@/domain/project';
import type { ProjectView } from '@/domain/view';
import { ProjectPickerList } from '@/features/projects/ProjectPickerList';
import { TaskList } from '@/features/tasks/TaskList';
import {
  TodayView,
  UpcomingView,
  LabelView,
  InboxView,
  FavoritesView,
} from '@/features/smart-views/SmartViews';
import { SearchView } from '@/features/search/SearchView';

// Heavy, conditionally-rendered project views — code-split out of the startup
// bundle. Only loaded when the active project view actually selects one. The
// default views (TaskList, SmartViews) stay eager so first paint isn't gated
// on a chunk fetch.
const KanbanBoard = lazy(() =>
  import('@/features/kanban/KanbanBoard').then((m) => ({ default: m.KanbanBoard })),
);
const TableView = lazy(() =>
  import('@/features/table/TableView').then((m) => ({ default: m.TableView })),
);
const GanttView = lazy(() =>
  import('@/features/gantt/GanttView').then((m) => ({ default: m.GanttView })),
);

function CenteredMessage({ children, detail }: { children: string; detail?: string }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm text-[var(--color-muted-foreground)]">{children}</p>
      {detail ? (
        <p className="max-w-md text-xs text-[var(--color-muted-foreground)]">{detail}</p>
      ) : null}
    </section>
  );
}

function ProjectViewBody({ project, view }: { project: Project; view: ProjectView }) {
  // Key each view by its localId so switching views remounts the
  // component instead of reusing per-view state (filter, collapsed
  // columns, edit drafts) seeded in useState initializers.
  switch (view.viewKind) {
    case 'kanban':
      return <KanbanBoard key={view.localId} view={view} project={project} />;
    case 'table':
      return <TableView key={view.localId} project={project} view={view} />;
    case 'gantt':
      return <GanttView key={view.localId} project={project} view={view} />;
    default:
      return <TaskList key={view.localId} project={project} view={view} />;
  }
}

function ProjectMain({
  currentProject,
  currentView,
  viewsPending,
}: {
  currentProject: Project | undefined;
  currentView: ProjectView | undefined;
  viewsPending: boolean;
}) {
  if (!currentProject) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Project not found.
        </p>
      </section>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {currentView ? (
        // Kanban/Table/Gantt are lazy-loaded — wrap in Suspense so the
        // chunk fetch shows a subtle placeholder instead of an empty
        // pane. TaskList is eager but harmless to nest here.
        <Suspense
          fallback={
            <section className="flex flex-1 items-center justify-center p-8">
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Loading…
              </p>
            </section>
          }
        >
          <ProjectViewBody project={currentProject} view={currentView} />
        </Suspense>
      ) : viewsPending ? (
        <section className="flex flex-1 items-center justify-center p-8">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Loading views…
          </p>
        </section>
      ) : (
        <section className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No views available for this project.
          </p>
        </section>
      )}
    </div>
  );
}

/** The main content pane for the active view. */
export function MainView({
  activeView,
  searchQuery,
  currentProject,
  currentView,
  viewsPending,
}: {
  activeView: ActiveView | null;
  searchQuery: string;
  currentProject: Project | undefined;
  currentView: ProjectView | undefined;
  viewsPending: boolean;
}) {
  if (!activeView) {
    return (
      <CenteredMessage detail="Create and manage your tasks offline, syncing automatically in the background.">
        Pick a project from the sidebar.
      </CenteredMessage>
    );
  }

  switch (activeView.kind) {
    case 'today':
      return <TodayView />;
    case 'upcoming':
      return <UpcomingView />;
    case 'label':
      return <LabelView labelLocalId={activeView.localId} />;
    case 'favorites':
      return <FavoritesView />;
    case 'inbox':
      return <InboxView />;
    case 'search':
      return <SearchView query={searchQuery} />;
    case 'browse':
      return <ProjectPickerList />;
    case 'project':
      return (
        <ProjectMain
          currentProject={currentProject}
          currentView={currentView}
          viewsPending={viewsPending}
        />
      );
  }
}
