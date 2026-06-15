import { useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { useUi } from '@/stores/ui';
import { updateTask } from '@/db/tasks';
import { DatePicker } from '@/components/DatePicker';
import type { Project } from '@/domain/project';
import type { ProjectView } from '@/domain/view';
import { useGanttData } from './useGanttData';
import { useGanttFilters } from './useGanttFilters';
import { GanttChart } from './GanttChart';

interface GanttViewProps {
  project: Project;
  view?: ProjectView;
}

/**
 * Gantt view: date-range controls over a CSS-positioned timeline chart with
 * an SVG dependency-arrow overlay. Reads the same local tasks as the list
 * view; dragging a bar (or its edges), or nudging it with the arrow keys,
 * writes start/end back through `updateTask`.
 *
 * Remaining gap vs Vikunja: arrows whose endpoint is hidden under a collapsed
 * parent are skipped rather than re-routed to the nearest visible ancestor.
 */
export function GanttView({ project, view }: GanttViewProps) {
  const { filters, setDateFrom, setDateTo, toggleDateless, toggleCompleted, reset } = useGanttFilters();
  const { nodes, relations, isLoading, isFetching, isError, error } = useGanttData(project, filters.showCompleted);
  const setSelectedTask = useUi((s) => s.setSelectedTask);

  const handleUpdateDates = useCallback(
    (taskLocalId: string, startIso: string, endIso: string) => {
      void updateTask(taskLocalId, { startDate: startIso, endDate: endIso }).catch(
        (err) => console.error('[gantt] failed to update task dates:', err),
      );
    },
    [],
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-6 py-2 text-xs text-[var(--color-muted-foreground)]">
        <div className="flex items-center gap-2">
          <span>From</span>
          <DatePicker value={filters.dateFrom} onChange={setDateFrom} placeholder="Start" />
          <span>to</span>
          <DatePicker value={filters.dateTo} onChange={setDateTo} placeholder="End" />
        </div>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={filters.showTasksWithoutDates}
            onChange={toggleDateless}
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]"
          />
          Show tasks without dates
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={filters.showCompleted}
            onChange={toggleCompleted}
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]"
          />
          Show completed
        </label>
        <button
          onClick={reset}
          className="inline-flex cursor-pointer items-center gap-1 hover:text-[var(--color-foreground)]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
        <span className="ml-auto">
          {isLoading ? 'Loading…' : isFetching ? 'syncing…' : `${nodes.length} task${nodes.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {nodes.length === 0 && !isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          No tasks to show on the timeline.
        </div>
      ) : (
        <GanttChart
          nodes={nodes}
          relations={relations}
          filters={filters}
          projectColor={project.hexColor}
          viewLocalId={view?.localId}
          projectLocalId={project.localId}
          onUpdateDates={handleUpdateDates}
          onOpenTask={setSelectedTask}
        />
      )}

      {isError ? (
        <p className="border-t border-[var(--color-border)] px-6 py-2 text-xs text-[var(--color-warning)]">
          Couldn't refresh{error instanceof Error ? `: ${error.message}` : ''}.
        </p>
      ) : null}
    </section>
  );
}
