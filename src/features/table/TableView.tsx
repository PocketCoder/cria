import { useMemo, useState } from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useProjectTasks } from '@/queries/tasks';
import { useProjects } from '@/queries/projects';
import { useCurrentUser } from '@/queries/user';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { useUi } from '@/stores/ui';
import type { Project } from '@/domain/project';
import { viewFilterParams } from '@/domain/view';
import type { ProjectView } from '@/domain/view';
import { useTableConfig } from './useTableConfig';
import { SortHeader } from './SortHeader';
import { ReorderErrorPill } from '@/components/ReorderErrorPill';
import { CompletedRows, SortableTableRow } from './TableRows';
import { computeSortOrder, taskCountLabel } from './tableLogic';
import { useProjectTitleLookup, useTableDrafts, useTableReorder, useTableTasks } from './useTableState';
import { TableToolbar } from './TableToolbar';

interface TableViewProps {
  project: Project;
  view?: ProjectView;
}

/**
 * Dense, sortable, multi-column table view. Reads the same
 * `useProjectTasks` data as the list view; column visibility + sort are
 * driven by `useTableConfig` (global localStorage). Row click opens the
 * task detail card, like the list view.
 */
export function TableView({ project, view }: TableViewProps) {
  const vf = view ? viewFilterParams(view) : null;
  const { data: tasks = [], isLoading, isFetching, isError, error } =
    useProjectTasks(project, vf?.filter, undefined, vf?.includeNulls ?? false);
  const { data: allProjects = [] } = useProjects();
  const pendingDeletes = usePendingDeletes((s) => s.pending);
  const { columns, visible, sortBy, toggleColumn, onSort, clearSort } = useTableConfig();
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const selectedTaskId = useUi((s) => s.selectedTaskLocalId);
  const { data: currentUser } = useCurrentUser();
  const currentUserServerId = currentUser?.serverId ?? null;

  const { editMode, setEditMode, drafts, setDraft, saveAndExit } = useTableDrafts(project.localId);

  const projectTitle = useProjectTitleLookup(allProjects);

  const [showCompleted, setShowCompleted] = useState(false);
  const { activeTasks, completedTasks, sorted, sortedCompleted } = useTableTasks({
    tasks,
    pendingDeletes,
    sortBy,
    projectTitle,
    visible,
  });

  const {
    activeId,
    reorderError,
    setReorderError,
    sensors,
    sortableItems,
    orderedRows,
    handleDragStart,
    handleDragEnd,
  } = useTableReorder({ sorted, view, projectLocalId: project.localId, clearSort });

  const shownColumns = useMemo(
    () => columns.filter((c) => visible[c.key]),
    [columns, visible],
  );

  // 1-based sort priority per column, only meaningful with >1 active key.
  const sortOrder = useMemo(() => computeSortOrder(sortBy, visible), [sortBy, visible]);

  const rowShared = {
    shownColumns,
    editMode,
    setDraft,
    projectTitle,
    currentUserServerId,
    selectedTaskId,
    setSelectedTask,
  };

  return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {reorderError && <ReorderErrorPill onClose={() => setReorderError(false)} />}
      <TableToolbar
        countLabel={taskCountLabel(activeTasks.length, completedTasks.length, isLoading)}
        isFetching={isFetching}
        editMode={editMode}
        onToggleEdit={() => (editMode ? saveAndExit() : setEditMode(true))}
        onSave={saveAndExit}
        visible={visible}
        onToggleColumn={toggleColumn}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--color-background)] text-xs">
              <tr className="border-b border-[var(--color-border)]">
                {shownColumns.map((c) => (
                  <SortHeader
                    key={c.key}
                    column={c}
                    dir={sortBy[c.key]}
                    order={sortOrder.get(c.key) ?? null}
                    onSort={(additive) => onSort(c.key, additive)}
                  />
                ))}
              </tr>
            </thead>
            <SortableContext
              items={sortableItems}
              strategy={verticalListSortingStrategy}
            >
              <tbody>
                {orderedRows.map((task) => (
                  <SortableTableRow
                    key={task.localId}
                    task={task}
                    draft={drafts[task.localId]}
                    {...rowShared}
                  />
                ))}
              </tbody>
            </SortableContext>
          </table>
          <DragOverlay>
            {activeId ? (
              <table className="w-full border-collapse text-sm">
                <tbody>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-card)] shadow-lg opacity-90">
                    <td className="px-3 py-2 text-sm">
                      {tasks.find((t) => t.localId === activeId)?.title ?? ''}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : null}
          </DragOverlay>
          {completedTasks.length > 0 ? (
            <CompletedRows
              completed={completedTasks.length}
              sortedCompleted={sortedCompleted}
              showCompleted={showCompleted}
              onToggle={() => setShowCompleted((s) => !s)}
              drafts={drafts}
              {...rowShared}
            />
          ) : null}
        </DndContext>

        {sorted.length === 0 && !isLoading ? (
          <p className="px-6 py-8 text-center text-sm text-[var(--color-muted-foreground)]">
            No tasks
          </p>
        ) : null}
      </div>

      {isError ? (
        <p className="border-t border-[var(--color-border)] px-6 py-2 text-xs text-[var(--color-warning-text)]">
          Couldn't refresh{error instanceof Error ? `: ${error.message}` : ''}.
        </p>
      ) : null}
    </section>
  );
}
