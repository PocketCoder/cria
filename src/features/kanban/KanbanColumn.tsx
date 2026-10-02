import { useState, useEffect, useMemo, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { KanbanColumn as KanbanColumnData } from '@/queries/kanban';
import { createTask } from '@/db/tasks';
import { setTaskBucket, deleteBucket, updateBucket } from '@/db/buckets';
import { updateView } from '@/db/views';
import { applyLabelsByTitle } from '@/db/labels';
import { cn } from '@/lib/cn';
import { useFocusOnMount } from '@/lib/useFocusOnMount';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  X,
  Check,
  Gauge,
  Flag,
} from 'lucide-react';
import type { ProjectView } from '@/domain/view';
import type { Bucket } from '@/domain/bucket';
import type { Task } from '@/domain/task';
import { KanbanCard } from './KanbanCard';
import { bucketRoles, buildKanbanTaskInput, isAtLimit, parseBucketLimit } from './kanbanLogic';

interface ColumnProps {
  column: KanbanColumnData;
  collapsed: boolean;
  onToggleCollapse: () => void;
  view: ProjectView;
  projectLocalId: string;
}

export function KanbanColumn({
  column,
  collapsed,
  onToggleCollapse,
  view,
  projectLocalId,
}: ColumnProps) {
  const { bucket, tasks } = column;
  const { isDone, isDefault } = bucketRoles(bucket, view);
  const atLimit = isAtLimit(bucket.limit, tasks.length);

  const { setNodeRef, isOver } = useDroppable({
    id: bucket.localId,
  });

  const taskIds = useMemo(() => tasks.map((t) => t.localId), [tasks]);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full w-72 shrink-0 flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)]/5',
        isOver && 'ring-2 ring-[var(--color-primary)]',
      )}
    >
      <BucketHeader
        bucket={bucket}
        view={view}
        taskCount={tasks.length}
        isDoneBucket={isDone}
        isDefaultBucket={isDefault}
        atLimit={atLimit}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
      />
      {!collapsed && <BucketTasks tasks={tasks} taskIds={taskIds} />}
      <AddTaskFooter
        hidden={collapsed}
        bucketLocalId={bucket.localId}
        viewLocalId={view.localId}
        projectLocalId={projectLocalId}
      />
    </div>
  );
}

/* ─── Header: collapse toggle, title / rename, role icons, count, menu ─── */

export function BucketHeader({
  bucket,
  view,
  taskCount,
  isDoneBucket,
  isDefaultBucket,
  atLimit,
  collapsed,
  onToggleCollapse,
}: {
  bucket: Bucket;
  view: ProjectView;
  taskCount: number;
  isDoneBucket: boolean;
  isDefaultBucket: boolean;
  atLimit: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  // Seeded from the bucket title when a rename starts (not at mount), so it
  // never shows a stale title or an abandoned edit.
  const [renameDraft, setRenameDraft] = useState('');
  const focusRenameInput = useFocusOnMount<HTMLInputElement>();

  const handleRenameSave = async () => {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== bucket.title) {
      try {
        await updateBucket(bucket.localId, { title: trimmed });
      } catch (err) {
        console.error('[kanban] failed to rename bucket:', err);
      }
    }
    setRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleRenameSave();
    else if (e.key === 'Escape') setRenaming(false);
  };

  const startRename = () => {
    setRenameDraft(bucket.title);
    setRenaming(true);
  };

  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <button
          aria-label={collapsed ? 'Expand bucket' : 'Collapse bucket'}
          onClick={onToggleCollapse}
          className="cursor-pointer text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {renaming ? (
          <div className="flex items-center gap-1">
            <input
              aria-label="Bucket name"
              ref={focusRenameInput}
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => void handleRenameSave()}
              onKeyDown={handleRenameKeyDown}
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
            />
          </div>
        ) : (
          <span className="truncate text-xs font-medium">{bucket.title}</span>
        )}
        {isDoneBucket ? (
          <Check className="h-3 w-3 shrink-0 text-[var(--color-primary)]" aria-label="Done bucket" />
        ) : null}
        {isDefaultBucket ? (
          <Flag className="h-3 w-3 shrink-0 text-[var(--color-primary)]" aria-label="Default bucket" />
        ) : null}
        <span
          className={cn(
            'ml-auto shrink-0 text-footnote tabular-nums',
            atLimit
              ? 'font-medium text-[var(--color-warning)]'
              : 'text-[var(--color-muted-foreground)]',
          )}
        >
          {bucket.limit > 0 ? `${taskCount}/${bucket.limit}` : taskCount}
        </span>
      </div>
      <BucketMenu
        bucket={bucket}
        view={view}
        isDoneBucket={isDoneBucket}
        isDefaultBucket={isDefaultBucket}
        onRename={startRename}
      />
    </div>
  );
}

/* ─── Overflow menu: rename, limit, done / default bucket, delete ─── */

function BucketMenu({
  bucket,
  view,
  isDoneBucket,
  isDefaultBucket,
  onRename,
}: {
  bucket: Bucket;
  view: ProjectView;
  isDoneBucket: boolean;
  isDefaultBucket: boolean;
  onRename: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showLimitInput, setShowLimitInput] = useState(false);
  const [limitDraft, setLimitDraft] = useState(String(bucket.limit || 0));
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  const handleDeleteBucket = async () => {
    try {
      await deleteBucket(bucket.localId);
    } catch (err) {
      console.error('[kanban] failed to delete bucket:', err);
    }
    setShowMenu(false);
  };

  const handleSetLimit = async () => {
    const n = parseBucketLimit(limitDraft);
    if (n !== bucket.limit) {
      try {
        await updateBucket(bucket.localId, { limit: n });
      } catch (err) {
        console.error('[kanban] failed to set bucket limit:', err);
      }
    }
    setShowLimitInput(false);
    setShowMenu(false);
  };

  const toggleDoneBucket = async () => {
    if (bucket.serverId == null) return;
    try {
      await updateView(view.localId, {
        doneBucketServerId: isDoneBucket ? null : bucket.serverId,
      });
    } catch (err) {
      console.error('[kanban] failed to toggle done bucket:', err);
    }
    setShowMenu(false);
  };

  const toggleDefaultBucket = async () => {
    if (bucket.serverId == null) return;
    try {
      await updateView(view.localId, {
        defaultBucketServerId: isDefaultBucket ? null : bucket.serverId,
      });
    } catch (err) {
      console.error('[kanban] failed to toggle default bucket:', err);
    }
    setShowMenu(false);
  };

  return (
    <div className="relative">
      <button
        aria-label="Bucket options"
        onClick={() => setShowMenu(!showMenu)}
        className="cursor-pointer rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/10"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute right-0 top-6 z-10 w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] py-1 shadow-lg"
        >
          <button
            onClick={() => {
              onRename();
              setShowMenu(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--color-accent)]/10 cursor-pointer"
          >
            <Pencil className="h-3 w-3" /> Rename
          </button>

          <LimitRow
            limit={bucket.limit}
            showInput={showLimitInput}
            draft={limitDraft}
            onDraftChange={setLimitDraft}
            onOpen={() => {
              setLimitDraft(String(bucket.limit || 0));
              setShowLimitInput(true);
            }}
            onCancel={() => setShowLimitInput(false)}
            onSave={() => void handleSetLimit()}
          />

          <RoleItem
            Icon={Check}
            active={isDoneBucket}
            activeLabel="Done bucket ✓"
            inactiveLabel="Set as done bucket"
            unsynced={bucket.serverId == null}
            onClick={toggleDoneBucket}
          />
          <RoleItem
            Icon={Flag}
            active={isDefaultBucket}
            activeLabel="Default bucket ✓"
            inactiveLabel="Set as default bucket"
            unsynced={bucket.serverId == null}
            onClick={toggleDefaultBucket}
          />

          <button
            onClick={handleDeleteBucket}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-warning)] hover:bg-[var(--color-accent)]/10 cursor-pointer"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

function LimitRow({
  limit,
  showInput,
  draft,
  onDraftChange,
  onOpen,
  onCancel,
  onSave,
}: {
  limit: number;
  showInput: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onOpen: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const focusLimitInput = useFocusOnMount<HTMLInputElement>();
  if (!showInput) {
    return (
      <button
        onClick={onOpen}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--color-accent)]/10 cursor-pointer"
      >
        <Gauge className="h-3 w-3" /> {limit > 0 ? `Limit: ${limit}` : 'Set limit'}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 px-3 py-1.5">
      <Gauge className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]" />
      <input
        aria-label="Task limit"
        type="number"
        min={0}
        ref={focusLimitInput}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onSave(); }
          else if (e.key === 'Escape') onCancel();
        }}
        className="w-14 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
      />
      <button
        onClick={onSave}
        className="cursor-pointer rounded p-0.5 text-[var(--color-primary)]"
        aria-label="Save limit"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function RoleItem({
  Icon,
  active,
  activeLabel,
  inactiveLabel,
  unsynced,
  onClick,
}: {
  Icon: typeof Check;
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  unsynced: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={unsynced}
      title={unsynced ? 'Sync the bucket first' : undefined}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--color-accent)]/10 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon
        className={cn(
          'h-3 w-3',
          active ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted-foreground)]',
        )}
      />
      {active ? activeLabel : inactiveLabel}
    </button>
  );
}

/* ─── Task list ─── */

function BucketTasks({ tasks, taskIds }: { tasks: Task[]; taskIds: string[] }) {
  return (
    <div className="flex-1 overflow-y-auto px-2 py-2">
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        {tasks.map((task) => (
          <KanbanCard key={task.localId} task={task} />
        ))}
      </SortableContext>
      {tasks.length === 0 && (
        <p className="py-4 text-center text-caption text-[var(--color-muted-foreground)]">
          No tasks
        </p>
      )}
    </div>
  );
}

/* ─── Add task input — always available; the WIP limit is advisory (shown via
   the highlighted count) and never blocks adding. Stays mounted while the
   column is collapsed so a half-typed task survives collapse/expand. ─── */

function AddTaskFooter({
  hidden,
  bucketLocalId,
  viewLocalId,
  projectLocalId,
}: {
  hidden: boolean;
  bucketLocalId: string;
  viewLocalId: string;
  projectLocalId: string;
}) {
  const [showNewInput, setShowNewInput] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const handleAddTask = async () => {
    // WIP limits are advisory: the column highlights when over the limit
    // (see the count indicator) but never blocks adding — matching drag,
    // where over-limit drops are already allowed.
    const built = buildKanbanTaskInput(newTitle, projectLocalId);
    if (!built) return;
    try {
      const task = await createTask(built.input);
      if (task.localId) {
        await setTaskBucket(task.localId, viewLocalId, bucketLocalId);
      }
      if (built.labelTitles.length > 0) {
        await applyLabelsByTitle(task.localId, built.labelTitles).catch(() => {});
      }
      setNewTitle('');
      setShowNewInput(false);
    } catch (err) {
      console.error('[kanban] failed to create task:', err);
    }
  };

  if (hidden) return null;

  return (
    <div className="border-t border-[var(--color-border)] px-2 py-2">
      {showNewInput ? (
        <div className="flex items-center gap-1">
          <input
            aria-label="New task title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void handleAddTask(); }
              else if (e.key === 'Escape') { setShowNewInput(false); setNewTitle(''); }
            }}
            placeholder="Add a task…"
            autoFocus
            className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-xs placeholder-[var(--color-muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
          />
          <button
            aria-label="Cancel new task"
            onClick={() => { setShowNewInput(false); setNewTitle(''); }}
            className="cursor-pointer rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            aria-label="Add task"
            onClick={() => void handleAddTask()}
            className="cursor-pointer rounded p-0.5 text-[var(--color-primary)] hover:text-[var(--color-primary)]/80"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowNewInput(true)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-foreground)] cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          Add task
        </button>
      )}
    </div>
  );
}
