import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, Trash2, Search } from 'lucide-react';
import { useUi } from '@/stores/ui';
import { onShortcut } from '@/lib/shortcutBus';
import { getTaskByLocalId, createTask, updateTask, moveTask, searchTasks, deleteTask } from '@/db/tasks';
import { getProjectByLocalId } from '@/db/projects';
import { searchProjectUsers } from '@/api/users';
import { toggleTaskLabel } from '@/db/labels';
import { subscribe } from '@/db/bus';
import { useTaskLabels } from '@/queries/taskLabels';
import { useLabels } from '@/queries/labels';
import { useTaskComments } from '@/queries/comments';
import { useTaskAttachments } from '@/queries/attachments';
import {
  listRelationsForTask,
  addRelation,
  removeRelation,
} from '@/db/relations';
import { listRemindersForTask, type TaskReminder } from '@/db/reminders';
import { useDateFormatter } from '@/lib/dateFormat';
import { RichTextEditor } from './RichTextEditor';
import { BreakDown } from './BreakDown';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { toggleTaskDone } from '@/features/tasks/taskRowHelpers';
import type { Task } from '@/domain/task';
import { getAuthSnapshot } from '@/auth/store';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/useIsMobile';
import { ChipRow } from './TaskChips';
import { DetailCard } from './DetailCard';
import { DetailChrome, DetailSections, MarkDoneButton, TaskTitle } from './DetailParts';
import {
  countRelated,
  escapeClosesInspector,
  taskWebUrl,
  type OpenSection,
  type Picker,
} from './taskDetailLogic';

export function TaskDetail() {
  // **All hooks before any early return** — React's hook-order rule.
  const selectedId = useUi((s) => s.selectedTaskLocalId);
  const setSelectedTask = useUi((s) => s.setSelectedTask);
  const queryClient = useQueryClient();
  const cardRef = useRef<HTMLElement>(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [openSection, setOpenSection] = useState<OpenSection>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const isMobile = useIsMobile();
  const dateFmt = useDateFormatter();

  // Desktop click-away: clicking outside the inspector dismisses it. Ignore
  // clicks on task rows (those switch selection) and on Radix popovers/dialogs
  // opened from the inspector (date/priority/label pickers portal to <body>,
  // so they're technically "outside" the card).
  useEffect(() => {
    if (isMobile || !selectedId) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (cardRef.current?.contains(t)) return;
      if (
        t.closest(
          '[data-task-row],[data-radix-popper-content-wrapper],[role="dialog"],dialog,[role="menu"],[data-sonner-toast]',
        )
      )
        return;
      setSelectedTask(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isMobile, selectedId, setSelectedTask]);

  useEffect(() => {
    return subscribe('tasks', () => {
      void queryClient.invalidateQueries({ queryKey: ['task'] });
    });
  }, [queryClient]);

  // Reset transient state whenever the selected task changes.
  useEffect(() => {
    setTitleEditing(false);
    setTitleDraft('');
    setOpenSection(null);
    setPicker(null);
  }, [selectedId]);

  // Escape closes the card while it's open.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (escapeClosesInspector(e, cardRef.current)) setSelectedTask(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, setSelectedTask]);

  const { data: task, isLoading, isError } = useQuery<Task | null>({
    queryKey: ['task', selectedId],
    queryFn: async () => (selectedId ? getTaskByLocalId(selectedId) : null),
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  const { data: labels = [] } = useTaskLabels(selectedId);
  const { data: allLabels = [] } = useLabels();

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  useTaskShortcuts(task, { copyText, setPicker, setOpenSection, setSelectedTask });

  const { data: taskProject } = useQuery({
    queryKey: ['project-of-task', task?.projectLocalId ?? null],
    queryFn: async () =>
      task ? getProjectByLocalId(task.projectLocalId) : null,
    enabled: !!task,
    staleTime: 60_000,
  });
  const projectServerId = taskProject?.serverId ?? null;
  const mentionSearch = useMemo(
    () =>
      projectServerId != null && projectServerId > 0
        ? (q: string) => searchProjectUsers(projectServerId, q)
        : undefined,
    [projectServerId],
  );

  // Counts for the collapsed rows (shared query keys with the sections).
  const { data: comments = [] } = useTaskComments(task?.localId ?? null);
  const { data: attachments = [] } = useTaskAttachments(task?.localId ?? null);
  const { data: reminders = [] } = useQuery<TaskReminder[]>({
    queryKey: ['reminders', task?.localId ?? null],
    enabled: !!task,
    staleTime: 30_000,
    queryFn: async () =>
      task?.localId ? listRemindersForTask(task.localId) : [],
  });
  const { data: relations = [] } = useQuery({
    queryKey: ['relations', task?.localId ?? null],
    enabled: !!task,
    staleTime: 30_000,
    queryFn: () => listRelationsForTask(task!.localId),
  });
  const relatedCount = countRelated(relations);

  // No selection: the inspector collapses entirely (both platforms) so the
  // content pane reclaims the width — no empty placeholder column.
  if (!selectedId) return null;

  const close = () => setSelectedTask(null);

  if (isLoading) {
    return (
      <DetailCard onClose={close} cardRef={cardRef}>
        <p className="px-[26px] py-5 text-sm text-[var(--color-muted-foreground)]">
          Loading…
        </p>
      </DetailCard>
    );
  }

  if (isError || !task) {
    return (
      <DetailCard onClose={close} cardRef={cardRef}>
        <p className="px-[26px] py-5 text-sm text-[var(--color-warning)]">
          Could not load task details.
        </p>
      </DetailCard>
    );
  }

  const handleDescriptionSave = async (next: string) => {
    await updateTask(task.localId, { description: next });
  };

  const handleToggleLabel = async (labelLocalId: string) => {
    try {
      await toggleTaskLabel(task.localId, labelLocalId);
      await queryClient.invalidateQueries({ queryKey: ['task-labels'] });
    } catch (err) {
      console.error('[labels] toggle failed:', err);
    }
  };

  const handleSetDate = async (field: 'dueDate' | 'startDate' | 'endDate', value: string | null) => {
    await updateTask(task.localId, { [field]: value } as Partial<Task>);
  };

  const handleCopyLink = async () => {
    const { serverUrl } = getAuthSnapshot();
    await copyText(taskWebUrl(task, serverUrl) ?? task.title);
  };

  const chrome = (
    <DetailChrome
      task={task}
      copied={copied}
      onCopyLink={() => void handleCopyLink()}
      onClose={close}
    />
  );

  return (
    <DetailCard onClose={close} header={chrome} cardRef={cardRef}>
      <div className="min-w-0 flex-1 overflow-y-auto px-[26px] pb-6 pt-1">
        {task.identifier ? (
          <p className="mb-2 font-mono text-[10.5px] tracking-[0.08em] text-[var(--color-muted-foreground)]">
            {task.identifier}
          </p>
        ) : null}

        <TaskTitle
          task={task}
          editing={titleEditing}
          setEditing={setTitleEditing}
          draft={titleDraft}
          setDraft={setTitleDraft}
        />

        <ChipRow
          task={task}
          labels={labels}
          project={taskProject ?? null}
          allLabels={allLabels}
          picker={picker}
          setPicker={setPicker}
          onToggleLabel={handleToggleLabel}
          onSetDate={handleSetDate}
          onMoveProject={(projectLocalId) => void moveTask(task.localId, projectLocalId)}
          onSetPriority={(p) => void updateTask(task.localId, { priority: p })}
          onSetColor={(hex) => void updateTask(task.localId, { hexColor: hex })}
        />

        <section className="mb-[22px]">
          <RichTextEditor
            key={task.localId}
            value={task.description}
            onSave={handleDescriptionSave}
            taskLocalId={task.localId}
            taskServerId={task.serverId}
            mentionSearch={mentionSearch}
          />
        </section>

        {/* Keyed so the add-subtask draft and Break down suggestions never
            carry over to the next task when it is already cached (no loading
            early-return remounts the tree). */}
        <SubtasksBlock
          key={task.localId}
          taskLocalId={task.localId}
          projectLocalId={task.projectLocalId}
          title={task.title}
          description={task.description}
        />

        <DetailSections
          task={task}
          openSection={openSection}
          setOpenSection={setOpenSection}
          reminders={reminders}
          attachmentCount={attachments.length}
          commentCount={comments.length}
          relatedCount={relatedCount}
          mentionSearch={mentionSearch}
          dateFmt={dateFmt}
          onDeleted={() => setSelectedTask(null)}
        />

        <MarkDoneButton task={task} />
      </div>
    </DetailCard>
  );
}

/** Fixed shortcut set: copy family + "open project" (upstream u / . / ⌘.) plus direct actions. */
function useTaskShortcuts(
  task: Task | null | undefined,
  actions: {
    copyText: (text: string) => Promise<void>;
    setPicker: (p: Picker) => void;
    setOpenSection: (s: OpenSection) => void;
    setSelectedTask: (id: string | null) => void;
  },
): void {
  const { copyText, setPicker, setOpenSection, setSelectedTask } = actions;
  useEffect(() => {
    if (!task) return;
    const url = () => taskWebUrl(task, getAuthSnapshot().serverUrl);
    const id = task.identifier ?? task.title;
    const subs = [
      onShortcut('task.copyId', () => void copyText(id)),
      onShortcut('task.copyIdTitle', () => void copyText(`${id} ${task.title}`)),
      onShortcut('task.copyIdTitleUrl', () =>
        void copyText(`${id} ${task.title} ${url() ?? ''}`.trim()),
      ),
      onShortcut('task.copyUrl', () => void copyText(url() ?? task.title)),
      onShortcut('task.openProject', () =>
        useUi.getState().setActiveView({ kind: 'project', localId: task.projectLocalId }),
      ),
      // Direct actions.
      onShortcut('task.done', () => void toggleTaskDone(task)),
      onShortcut('task.favorite', () =>
        void updateTask(task.localId, { isFavorite: !task.isFavorite }),
      ),
      onShortcut('task.delete', () => {
        // Mirror TaskActions' "Delete forever?" confirmation — the mouse
        // path never deletes in one step, so the shortcut shouldn't either.
        if (!window.confirm('Delete this task forever?')) return;
        void deleteTask(task.localId).then(() => setSelectedTask(null));
      }),
      // Picker-opening actions — open the same popover/section the mouse uses.
      onShortcut('task.priority', () => setPicker('priority')),
      onShortcut('task.dueDate', () => setPicker('due')),
      onShortcut('task.move', () => setPicker('project')),
      onShortcut('task.labels', () => setPicker('label')),
      onShortcut('task.color', () => setPicker('colour')),
      onShortcut('task.assign', () => setOpenSection('more')),
    ];
    return () => subs.forEach((u) => u());
  });
}

/* ─── subtasks ─── */

function SubtasksBlock({
  taskLocalId,
  projectLocalId,
  title,
  description,
}: {
  taskLocalId: string;
  projectLocalId: string;
  title: string;
  description: string | null;
}) {
  const qc = useQueryClient();
  const aiAvailable = useAiAvailable();
  const { data: relations } = useQuery({
    queryKey: ['relations', taskLocalId],
    queryFn: () => listRelationsForTask(taskLocalId),
    staleTime: 30_000,
  });
  // Memoised so the search effect below only re-runs when the relations change.
  const subtasks = useMemo(() => (relations ?? []).filter((r) => r.kind === 'subtask'), [relations]);
  const done = subtasks.filter((r) => r.otherTaskDone).length;
  const pct = subtasks.length > 0 ? Math.round((done / subtasks.length) * 100) : 0;
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ localId: string; title: string }>>([]);

  useEffect(() => {
    // Functional update keeps the same state when already empty, so a no-op
    // clear never schedules a re-render.
    const clear = () => setResults((prev) => (prev.length === 0 ? prev : []));
    if (!adding || query.trim().length < 1) {
      clear();
      return;
    }
    const t = setTimeout(() => {
      void searchTasks({ text: query })
        .then((rows) => {
          const taken = new Set(subtasks.map((s) => s.otherTaskLocalId).filter(Boolean));
          setResults(
            rows
              .filter((r) => r.localId !== taskLocalId && !taken.has(r.localId))
              .slice(0, 8)
              .map((r) => ({ localId: r.localId, title: r.title })),
          );
        })
        .catch(clear);
    }, 120);
    return () => clearTimeout(t);
  }, [adding, query, subtasks, taskLocalId]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['relations', taskLocalId] });
  };

  const handlePick = async (otherLocalId: string) => {
    await addRelation(taskLocalId, otherLocalId, 'subtask');
    setQuery('');
    await refresh();
  };

  // New subtask lands in the parent's project, then gets linked.
  const handleCreate = async () => {
    const title = query.trim();
    if (!title) return;
    const created = await createTask({ projectLocalId, title });
    await handlePick(created.localId);
  };

  const handleRemove = async (r: { otherTaskLocalId: string | null; otherTaskServerId: number | null }) => {
    if (!r.otherTaskLocalId) return;
    await removeRelation(taskLocalId, r.otherTaskLocalId, r.otherTaskServerId, 'subtask');
    await refresh();
  };

  const handleToggle = async (r: { otherTaskLocalId: string | null; otherTaskDone: boolean }) => {
    if (!r.otherTaskLocalId) return;
    await updateTask(r.otherTaskLocalId, { done: !r.otherTaskDone });
  };

  return (
    <section className="mb-[22px]">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="group-label text-[var(--color-muted-foreground)]">
          Subtasks
        </span>
        {subtasks.length > 0 ? (
          <span className="text-[11.5px] tabular-nums text-[var(--color-muted-foreground)]">
            {done} / {subtasks.length}
          </span>
        ) : null}
        {subtasks.length > 0 ? (
          <span className="h-[3px] flex-1 overflow-hidden rounded-[2px] bg-[var(--color-border)]">
            <span
              className="block h-full rounded-[2px] bg-[var(--color-primary)] transition-all"
              style={{ width: `${pct}%` }}
            />
          </span>
        ) : null}
      </div>

      {subtasks.map((r) => (
        <div
          key={r.otherTaskLocalId ?? `${r.otherTaskTitle}-${r.createdAt}`}
          className="flex items-center gap-2.5 py-1.5 text-[13.5px]"
        >
          <button
            type="button"
            onClick={() => void handleToggle(r)}
            aria-label={r.otherTaskDone ? 'Mark not done' : 'Mark done'}
            className={cn(
              'flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full transition-colors cursor-pointer',
              r.otherTaskDone
                ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                : 'border-[1.5px] border-[var(--color-muted-foreground)]/40',
            )}
          >
            {r.otherTaskDone ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
          </button>
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              r.otherTaskDone && 'opacity-50 line-through',
            )}
          >
            {r.otherTaskTitle}
          </span>
          <button
            type="button"
            onClick={() => void handleRemove(r)}
            aria-label="Remove subtask"
            className="rounded p-1 text-[var(--color-muted-foreground)] opacity-0 transition-opacity hover:text-[var(--color-destructive)] hover:bg-[var(--color-muted)] group-hover:opacity-100 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="py-1">
          <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
            <input
              aria-label="Search tasks"
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  // Cancels the search only, not the inspector behind it.
                  e.preventDefault();
                  e.stopPropagation();
                  setAdding(false);
                  setQuery('');
                } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
              placeholder="New subtask or search…"
              className="w-full bg-transparent text-[13.5px] focus:outline-none"
            />
          </div>
          {query.trim() ? (
            <div className="mt-1 flex max-h-48 flex-col overflow-y-auto">
              <button
                type="button"
                onClick={() => void handleCreate()}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-[var(--color-muted)] cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                <span className="min-w-0 flex-1 truncate">
                  Create “{query.trim()}”
                </span>
                <span className="text-[11px] text-[var(--color-muted-foreground)]">Enter</span>
              </button>
              {results.map((r) => (
                <button
                  key={r.localId}
                  type="button"
                  onClick={() => void handlePick(r.localId)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-[var(--color-muted)] cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 rounded-md px-1 py-1.5 text-[13.5px] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
          >
            <Plus className="h-[15px] w-[15px]" />
            Add subtask
          </button>
          {aiAvailable && (
            <BreakDown
              title={title}
              description={description}
              existing={subtasks.map((s) => s.otherTaskTitle ?? '')}
              onAdd={async (titles) => {
                for (const t of titles) {
                  const created = await createTask({ projectLocalId, title: t });
                  await addRelation(taskLocalId, created.localId, 'subtask');
                }
                await refresh();
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}
