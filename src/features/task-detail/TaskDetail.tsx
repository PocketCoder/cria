import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Star,
  Ellipsis,
  X,
  Plus,
  Calendar as CalendarIcon,
  Bell,
  Paperclip,
  MessageSquare,
  RefreshCw,
  Check,
  ChevronRight,
  Trash2,
  Search,
  Link2,
} from 'lucide-react';
import { format } from 'date-fns';
import { useUi } from '@/stores/ui';
import { onShortcut } from '@/lib/shortcutBus';
import { getTaskByLocalId, updateTask, moveTask, searchTasks, deleteTask } from '@/db/tasks';
import { getProjectByLocalId, listProjects } from '@/db/projects';
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
import { listRemindersForTask, type TaskReminder, type ReminderRelation } from '@/db/reminders';
import { formatRelativeReminder } from '@/lib/period';
import { useDateFormatter, toCalendarDate, hasTimeOfDay, type DateFormatters } from '@/lib/dateFormat';
import { RichTextEditor } from './RichTextEditor';
import { TaskActions, InlineRepeat, COLOR_PRESETS } from './TaskActions';
import { AttachmentList } from './AttachmentList';
import { ReminderList } from './ReminderList';
import { CommentSection } from './CommentSection';
import { RelatedTasks } from './RelatedTasks';
import { toggleTaskDone } from '@/features/tasks/TaskRowCore';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { PrioritySelect, PRIORITY_LABELS, priorityColor } from '@/components/ui/priority-select';
import type { Task } from '@/domain/task';
import type { Label } from '@/domain/label';
import type { Project } from '@/domain/project';
import { getAuthSnapshot } from '@/auth/store';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/useIsMobile';

type OpenSection = 'reminders' | 'attachments' | 'comments' | 'related' | 'repeat' | 'more' | null;

/** Which chip picker is open. Controlled so keyboard shortcuts (d/p/m/l/c) can
 * open the same popovers the chips open on click. */
type Picker = 'due' | 'priority' | 'project' | 'label' | 'colour' | null;

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
          '[data-task-row],[data-radix-popper-content-wrapper],[role="dialog"],[role="menu"],[data-sonner-toast]',
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
      if (e.key === 'Escape') setSelectedTask(null);
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

  // Fixed shortcut set: copy family + "open project" (upstream u / . / ⌘.).
  useEffect(() => {
    if (!task) return;
    const copyText = async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* clipboard may be unavailable */
      }
    };
    const url = () => {
      const { serverUrl } = getAuthSnapshot();
      return task.serverId && serverUrl
        ? `${serverUrl.replace(/\/+$/, '')}/tasks/${task.serverId}`
        : null;
    };
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
  const relatedCount = relations.filter(
    (r) => r.kind !== 'subtask' && r.kind !== 'parenttask',
  ).length;

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

  const handleTitleEdit = () => {
    setTitleDraft(task.title);
    setTitleEditing(true);
  };

  const handleTitleSave = async () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== task.title) {
      await updateTask(task.localId, { title: trimmed });
    }
    setTitleEditing(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleTitleSave();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setTitleEditing(false);
    }
  };

  const handleDescriptionSave = async (next: string) => {
    await updateTask(task.localId, { description: next });
  };

  const handleDeleted = () => {
    setSelectedTask(null);
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
    const text =
      task.serverId && serverUrl
        ? `${serverUrl.replace(/\/+$/, '')}/tasks/${task.serverId}`
        : task.title;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const chrome = (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => void updateTask(task.localId, { isFavorite: !task.isFavorite })}
        aria-label={task.isFavorite ? 'Unfavourite' : 'Favourite'}
        className="rounded p-1.5 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
      >
        <Star
          className="h-[15px] w-[15px]"
          style={{ color: task.isFavorite ? 'var(--color-warning)' : undefined }}
          fill={task.isFavorite ? 'currentColor' : 'none'}
        />
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            className="rounded p-1.5 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
          >
            <Ellipsis className="h-[15px] w-[15px]" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-44 p-1">
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-[var(--color-muted)] cursor-pointer"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </PopoverContent>
      </Popover>
      <button
        type="button"
        onClick={close}
        aria-label="Close details"
        className="rounded p-1.5 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
      >
        <X className="h-[15px] w-[15px]" />
      </button>
    </div>
  );

  return (
    <DetailCard onClose={close} header={chrome} cardRef={cardRef}>
      <div className="min-w-0 flex-1 overflow-y-auto px-[26px] pb-6 pt-1">
        {task.identifier ? (
          <p className="mb-2 font-mono text-[10.5px] tracking-[0.08em] text-[var(--color-muted-foreground)]">
            {task.identifier}
          </p>
        ) : null}

        {titleEditing ? (
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void handleTitleSave()}
            onKeyDown={handleTitleKeyDown}
            autoFocus
            className="mb-[18px] w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-1.5 py-0.5 text-[21px] font-semibold leading-[1.28] tracking-[-0.025em] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          />
        ) : (
          <h2
            className="mb-[18px] cursor-pointer text-[21px] font-semibold leading-[1.28] tracking-[-0.025em] transition-colors hover:opacity-80"
            onClick={handleTitleEdit}
            title="Click to edit"
          >
            {task.title}
          </h2>
        )}

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

        <SubtasksBlock taskLocalId={task.localId} />

        <div className="mt-5 border-t border-[var(--color-border)] pt-1.5">
          <CollapsedRow
            icon={<Bell className="h-[15px] w-[15px]" />}
            label="Reminders"
            value={reminderSummary(reminders, dateFmt)}
            expanded={openSection === 'reminders'}
            onToggle={() =>
              setOpenSection(openSection === 'reminders' ? null : 'reminders')
            }
          >
            <ReminderList taskLocalId={task.localId} hideHeader />
          </CollapsedRow>
          <CollapsedRow
            icon={<Paperclip className="h-[15px] w-[15px]" />}
            label="Attachments"
            value={attachments.length > 0 ? `${attachments.length}` : 'None'}
            expanded={openSection === 'attachments'}
            onToggle={() =>
              setOpenSection(openSection === 'attachments' ? null : 'attachments')
            }
          >
            <AttachmentList
              taskLocalId={task.localId}
              taskServerId={task.serverId}
              hideHeader
            />
          </CollapsedRow>
          <CollapsedRow
            icon={<MessageSquare className="h-[15px] w-[15px]" />}
            label="Comments"
            value={comments.length > 0 ? `${comments.length}` : 'None'}
            expanded={openSection === 'comments'}
            onToggle={() =>
              setOpenSection(openSection === 'comments' ? null : 'comments')
            }
          >
            <CommentSection
              taskLocalId={task.localId}
              taskServerId={task.serverId}
              mentionSearch={mentionSearch}
              hideHeader
            />
          </CollapsedRow>
          <CollapsedRow
            icon={<Link2 className="h-[15px] w-[15px]" />}
            label="Related"
            value={relatedCount > 0 ? `${relatedCount}` : 'None'}
            expanded={openSection === 'related'}
            onToggle={() =>
              setOpenSection(openSection === 'related' ? null : 'related')
            }
          >
            <RelatedTasks
              taskLocalId={task.localId}
              taskServerId={task.serverId}
              hideHeader
              excludeSubtasks
            />
          </CollapsedRow>
          <CollapsedRow
            icon={<RefreshCw className="h-[15px] w-[15px]" />}
            label="Repeat"
            value={repeatLabel(task)}
            expanded={openSection === 'repeat'}
            onToggle={() =>
              setOpenSection(openSection === 'repeat' ? null : 'repeat')
            }
          >
            <InlineRepeat
              task={task}
              expanded={openSection === 'repeat'}
              onToggle={() => setOpenSection(openSection === 'repeat' ? null : 'repeat')}
            />
          </CollapsedRow>
          <CollapsedRow
            icon={<Ellipsis className="h-[15px] w-[15px]" />}
            label="More"
            value={undefined}
            hint="progress · move · duplicate"
            expanded={openSection === 'more'}
            onToggle={() =>
              setOpenSection(openSection === 'more' ? null : 'more')
            }
          >
            <div className="px-1 pb-1">
              <TaskActions task={task} onDeleted={handleDeleted} />
            </div>
          </CollapsedRow>
        </div>

        <button
          type="button"
          onClick={() => void toggleTaskDone(task)}
          className="mt-[22px] flex w-full items-center justify-center gap-2 rounded-[9px] bg-[var(--color-inverse)] px-3 py-[11px] text-[13.5px] font-medium text-[var(--color-inverse-foreground)] transition-opacity hover:opacity-90 cursor-pointer"
        >
          <Check className="h-[15px] w-[15px]" strokeWidth={2} />
          {task.done ? 'Mark not done' : 'Mark done'}
        </button>
      </div>
    </DetailCard>
  );
}

/* ─── chip row ─── */

function Chip({
  children,
  onClick,
  dashed = false,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  dashed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-[5px] text-[12.5px] transition-colors cursor-pointer',
        dashed
          ? 'border border-dashed border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]'
          : 'border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

function ChipRow({
  task,
  labels,
  project,
  allLabels,
  picker,
  setPicker,
  onToggleLabel,
  onSetDate,
  onMoveProject,
  onSetPriority,
  onSetColor,
}: {
  task: Task;
  labels: Label[];
  project: Project | null;
  allLabels: Label[];
  picker: Picker;
  setPicker: (p: Picker) => void;
  onToggleLabel: (labelLocalId: string) => Promise<void>;
  onSetDate: (field: 'dueDate' | 'startDate' | 'endDate', value: string | null) => Promise<void>;
  onMoveProject: (projectLocalId: string) => void;
  onSetPriority: (p: number) => void;
  onSetColor: (hex: string) => void;
}) {

  return (
    <div className="mb-[22px] flex flex-wrap gap-1.5">
      <ProjectChip
        project={project}
        onMove={onMoveProject}
        open={picker === 'project'}
        onOpenChange={(o) => setPicker(o ? 'project' : null)}
      />

      <Popover open={picker === 'due'} onOpenChange={(o) => setPicker(o ? 'due' : null)}>
        <PopoverTrigger asChild>
          <Chip>
            <CalendarIcon className="h-3 w-3" />
            {task.dueDate ? formatDueChip(task.dueDate) : 'Due date'}
          </Chip>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-auto p-2">
          <Calendar
            selected={task.dueDate ? toCalendarDate(task.dueDate) : undefined}
            onSelect={(date) => {
              void onSetDate(
                'dueDate',
                date ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString() : null,
              );
            }}
            onClear={() => void onSetDate('dueDate', null)}
          />
        </PopoverContent>
      </Popover>

      <Popover open={picker === 'priority'} onOpenChange={(o) => setPicker(o ? 'priority' : null)}>
        <PopoverTrigger asChild>
          <Chip>
            {task.priority > 2 ? (
              <span
                className="h-3 w-[3px] shrink-0 rounded-[2px]"
                style={{ background: priorityColor(task.priority) }}
              />
            ) : null}
            {PRIORITY_LABELS[task.priority] ?? 'Priority'}
          </Chip>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-48 p-1">
          <PrioritySelect
            value={task.priority}
            onChange={(p) => void onSetPriority(p)}
          />
        </PopoverContent>
      </Popover>

      {labels.map((label) => (
        <LabelPickerPopover
          key={label.localId}
          trigger={
            <Chip onClick={undefined}>
              <Dot color={label.hexColor || 'var(--color-muted-foreground)'} />
              {label.title}
            </Chip>
          }
          labels={labels}
          allLabels={allLabels}
          onToggleLabel={onToggleLabel}
        />
      ))}

      <AddChip
        labels={labels}
        allLabels={allLabels}
        onToggleLabel={onToggleLabel}
        onSetDate={onSetDate}
        onSetColor={onSetColor}
        task={task}
        picker={picker}
        setPicker={setPicker}
      />
    </div>
  );
}

function ProjectChip({
  project,
  onMove,
  open,
  onOpenChange,
}: {
  project: Project | null;
  onMove: (projectLocalId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: projects = [] } = useQuery({
    queryKey: ['all-projects'],
    queryFn: listProjects,
    staleTime: 30_000,
  });
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Chip>
          <Dot color={project?.hexColor || 'var(--color-muted-foreground)'} />
          {project?.title ?? 'Project'}
        </Chip>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-56 p-1">
        <div className="flex max-h-64 flex-col overflow-y-auto">
          {projects.map((p) => (
            <button
              key={p.localId}
              type="button"
              onClick={() => void onMove(p.localId)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-[var(--color-muted)] cursor-pointer',
                p.localId === project?.localId && 'bg-[var(--color-muted)]',
              )}
            >
              <Dot color={p.hexColor || 'var(--color-muted-foreground)'} />
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              {p.localId === project?.localId ? (
                <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" />
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LabelPickerPopover({
  trigger,
  labels,
  allLabels,
  onToggleLabel,
}: {
  trigger: React.ReactNode;
  labels: Label[];
  allLabels: Label[];
  onToggleLabel: (labelLocalId: string) => Promise<void>;
}) {
  const applied = new Set(labels.map((l) => l.localId));
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-56 p-1">
        <div className="flex max-h-64 flex-col overflow-y-auto">
          {allLabels.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-[var(--color-muted-foreground)]">
              No labels yet — create one in the sidebar.
            </p>
          ) : (
            allLabels.map((label) => {
              const on = applied.has(label.localId);
              return (
                <button
                  key={label.localId}
                  type="button"
                  onClick={() => void onToggleLabel(label.localId)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-[var(--color-muted)] cursor-pointer',
                    on && 'bg-[var(--color-muted)]',
                  )}
                >
                  <Dot color={label.hexColor || 'var(--color-muted-foreground)'} />
                  <span className="min-w-0 flex-1 truncate">{label.title}</span>
                  {on ? <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" /> : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AddChip({
  labels,
  allLabels,
  onToggleLabel,
  onSetDate,
  onSetColor,
  task,
  picker,
  setPicker,
}: {
  labels: Label[];
  allLabels: Label[];
  onToggleLabel: (labelLocalId: string) => Promise<void>;
  onSetDate: (field: 'dueDate' | 'startDate' | 'endDate', value: string | null) => Promise<void>;
  onSetColor: (hex: string) => void;
  task: Task;
  picker: Picker;
  setPicker: (p: Picker) => void;
}) {
  const [view, setView] = useState<'menu' | 'start' | 'end' | 'colour' | 'label'>('menu');
  const [open, setOpen] = useState(false);

  // The `label` / `colour` keyboard shortcuts route through `picker`: open the
  // popover straight to that sub-view instead of the menu.
  useEffect(() => {
    if (picker === 'label') {
      setView('label');
      setOpen(true);
    } else if (picker === 'colour') {
      setView('colour');
      setOpen(true);
    }
  }, [picker]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          // Mouse-opened (no pending picker) → start at the menu.
          if (picker !== 'label' && picker !== 'colour') setView('menu');
        } else {
          setPicker(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Chip dashed>
          <Plus className="h-3 w-3" />
          Add
        </Chip>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 p-1">
        {view === 'menu' ? (
          <div className="flex flex-col">
            {[
              { key: 'start' as const, label: 'Start date' },
              { key: 'end' as const, label: 'End date' },
              { key: 'colour' as const, label: 'Colour' },
              { key: 'label' as const, label: 'Label' },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setView(item.key)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-[var(--color-muted)] cursor-pointer"
              >
                <ChevronRight className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                {item.label}
              </button>
            ))}
          </div>
        ) : view === 'colour' ? (
          <div className="p-1">
            <div className="grid grid-cols-5 gap-1.5">
              {COLOR_PRESETS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => void onSetColor(hex)}
                  aria-label={hex}
                  className={cn(
                    'h-7 w-7 rounded-md border border-[var(--color-border)] transition-transform hover:scale-110 cursor-pointer',
                    task.hexColor === hex && 'ring-2 ring-[var(--color-ring)]',
                  )}
                  style={{ background: hex }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => void onSetColor(null as unknown as string)}
              className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-[13.5px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] cursor-pointer"
            >
              Remove colour
            </button>
          </div>
        ) : view === 'label' ? (
          <LabelList labels={labels} allLabels={allLabels} onToggleLabel={onToggleLabel} />
        ) : (
          <div className="p-2">
            <Calendar
              selected={
                view === 'start' && task.startDate
                  ? toCalendarDate(task.startDate)
                  : view === 'end' && task.endDate
                    ? toCalendarDate(task.endDate)
                    : undefined
              }
              onSelect={(date) => {
                void onSetDate(
                  view === 'start' ? 'startDate' : 'endDate',
                  date ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString() : null,
                );
              }}
              onClear={() =>
                void onSetDate(view === 'start' ? 'startDate' : 'endDate', null)
              }
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function LabelList({
  labels,
  allLabels,
  onToggleLabel,
}: {
  labels: Label[];
  allLabels: Label[];
  onToggleLabel: (labelLocalId: string) => Promise<void>;
}) {
  const applied = new Set(labels.map((l) => l.localId));
  return (
    <div className="flex max-h-64 flex-col overflow-y-auto">
      {allLabels.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-[var(--color-muted-foreground)]">
          No labels yet — create one in the sidebar.
        </p>
      ) : (
        allLabels.map((label) => {
          const on = applied.has(label.localId);
          return (
            <button
              key={label.localId}
              type="button"
              onClick={() => void onToggleLabel(label.localId)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-[var(--color-muted)] cursor-pointer',
                on && 'bg-[var(--color-muted)]',
              )}
            >
              <Dot color={label.hexColor || 'var(--color-muted-foreground)'} />
              <span className="min-w-0 flex-1 truncate">{label.title}</span>
              {on ? <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" /> : null}
            </button>
          );
        })
      )}
    </div>
  );
}

/* ─── subtasks ─── */

function SubtasksBlock({ taskLocalId }: { taskLocalId: string }) {
  const qc = useQueryClient();
  const { data: relations = [] } = useQuery({
    queryKey: ['relations', taskLocalId],
    queryFn: () => listRelationsForTask(taskLocalId),
    staleTime: 30_000,
  });
  const subtasks = relations.filter((r) => r.kind === 'subtask');
  const done = subtasks.filter((r) => r.otherTaskDone).length;
  const pct = subtasks.length > 0 ? Math.round((done / subtasks.length) * 100) : 0;
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ localId: string; title: string }>>([]);

  useEffect(() => {
    if (!adding || query.trim().length < 1) {
      setResults([]);
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
        .catch(() => setResults([]));
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
        <span className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]">
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
                ? 'bg-[var(--color-primary)] text-white'
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
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setAdding(false);
                  setQuery('');
                }
              }}
              placeholder="Search tasks…"
              className="w-full bg-transparent text-[13.5px] focus:outline-none"
            />
          </div>
          {results.length > 0 ? (
            <div className="mt-1 flex max-h-40 flex-col overflow-y-auto">
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
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 rounded-md px-1 py-1.5 text-[13.5px] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
        >
          <Plus className="h-[15px] w-[15px]" />
          Add subtask
        </button>
      )}
    </section>
  );
}

/* ─── collapsed rows ─── */

function CollapsedRow({
  icon,
  label,
  value,
  hint,
  expanded,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  hint?: string;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-t border-[var(--color-border)] py-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 rounded-[7px] px-1.5 py-2 text-left text-[13.5px] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
      >
        <span className="shrink-0 text-[var(--color-muted-foreground)]">{icon}</span>
        <span className="flex-1">{label}</span>
        {hint ? (
          <span className="text-[11.5px] text-[var(--color-muted-foreground)]">{hint}</span>
        ) : value ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">{value}</span>
        ) : null}
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)] transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded ? <div className="pb-1">{children}</div> : null}
    </div>
  );
}

/* ─── helpers ─── */

function formatDueChip(iso: string): string {
  try {
    const base = format(toCalendarDate(iso), 'EEE d MMM');
    return hasTimeOfDay(iso) ? `${base}, ${format(new Date(iso), 'HH:mm')}` : base;
  } catch {
    return iso;
  }
}

function reminderSummary(reminders: TaskReminder[], fmt: DateFormatters): string {
  if (reminders.length === 0) return 'None';
  const r = reminders[0]!;
  if (r.relativePeriod != null && r.relativeTo) {
    return formatRelativeReminder(r.relativePeriod, r.relativeTo as ReminderRelation);
  }
  if (r.reminderAt) return fmt.formatDateTime(r.reminderAt);
  return 'Reminder';
}

function repeatLabel(task: Task): string {
  if (task.repeatAfter <= 0) return 'Never';
  if (task.repeatMode === 1) return 'Monthly';
  const s = task.repeatAfter;
  if (s >= 2592000 && s % 2592000 === 0) return `Every ${s / 2592000} month${s / 2592000 > 1 ? 's' : ''}`;
  if (s >= 86400 && s % 86400 === 0) return `Every ${s / 86400} day${s / 86400 > 1 ? 's' : ''}`;
  if (s >= 3600 && s % 3600 === 0) return `Every ${s / 3600} hour${s / 3600 > 1 ? 's' : ''}`;
  return `Every ${s}s`;
}

/**
 * The inspector chrome: a permanent right-hand column on desktop (in-flow
 * flex item beside the list) and an iOS-style sheet on mobile. The chrome
 * strip (favourite / overflow / close) renders at the top, right-aligned.
 */
function DetailCard({
  onClose,
  header,
  cardRef,
  children,
}: {
  onClose: () => void;
  header?: React.ReactNode;
  cardRef?: React.Ref<HTMLElement>;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetOffset, setSheetOffset] = useState(0);
  const offsetRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isMobile) return;
    const el = sheetRef.current;
    if (!el) return;

    const THRESHOLD = 8;
    let startX = 0;
    let startY = 0;
    let atTop = false;
    let dragging = false;
    let decided = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0]!.clientX;
      startY = e.touches[0]!.clientY;
      atTop = el.scrollTop <= 0;
      dragging = false;
      decided = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (!dragging) {
        if (decided || !atTop) return;
        const dx = e.touches[0]!.clientX - startX;
        const dy = e.touches[0]!.clientY - startY;
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          decided = true;
          return;
        }
        dragging = true;
        decided = true;
        startY = e.touches[0]!.clientY;
      }
      e.preventDefault();
      const dy = Math.max(0, e.touches[0]!.clientY - startY);
      offsetRef.current = dy;
      setSheetOffset(dy);
    };

    const onTouchEnd = () => {
      if (!dragging) return;
      dragging = false;
      const dy = offsetRef.current;
      offsetRef.current = 0;
      if (dy > 120) onCloseRef.current();
      else setSheetOffset(0);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isMobile]);

  return (
    <>
      {isMobile && (
        <div className="sheet-backdrop fixed inset-0 z-40" onClick={onClose} />
      )}
      <aside
        ref={cardRef}
        role="dialog"
        aria-label="Task details"
        className={cn(
          'flex flex-col overflow-hidden',
          isMobile
            ? 'fixed inset-x-0 bottom-0 z-50 max-h-[90vh] rounded-t-2xl bg-[var(--color-card)] shadow-[0_-4px_20px_rgba(0,0,0,0.15)] animate-[sheet-up_350ms_var(--spring-snappy)]'
            : 'relative w-[372px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-background)]',
        )}
        style={isMobile && sheetOffset > 0 ? { transform: `translateY(${sheetOffset}px)`, transition: 'none' } : undefined}
      >
        <div ref={sheetRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {isMobile && (
            <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-[var(--color-muted-foreground)]/30" />
          )}
          <header className="flex shrink-0 items-center justify-end px-3.5 py-[13px]">
            {header ?? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close details"
                className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </header>
          {children}
        </div>
      </aside>
    </>
  );
}
