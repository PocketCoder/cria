import { useState, useEffect, forwardRef, type ButtonHTMLAttributes } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Tags,
  AlertTriangle,
  Percent,
  Palette,
  Calendar,
  Play,
  Square,
  ArrowLeftFromLine,
  Copy,
  Trash2,
  Star,
  Bell,
  User,
  RefreshCw,
} from 'lucide-react';
import { updateTask, deleteTask, duplicateTask, moveTask } from '@/db/tasks';
import { listLabels, toggleTaskLabel } from '@/db/labels';
import { listProjects } from '@/db/projects';
import { listAssigneesForTask, addTaskAssignee, removeTaskAssignee } from '@/db/task-assignees';
import { subscribeToTask, unsubscribeFromTask } from '@/sync/push';
import { useTaskLabels } from '@/queries/taskLabels';
import type { Task } from '@/domain/task';
import type { TaskAssignee } from '@/domain/task-assignee';
import type { Label } from '@/domain/label';
import type { Project } from '@/domain/project';
import { cn } from '@/lib/cn';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar as CalendarGrid } from '@/components/ui/calendar';

interface TaskActionsProps {
  task: Task;
  onDeleted: () => void;
}

export function TaskActions({ task, onDeleted }: TaskActionsProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: labels = [] } = useTaskLabels(task.localId);

  const { data: allLabels = [] } = useQuery<Label[]>({
    queryKey: ['all-labels'],
    queryFn: listLabels,
    staleTime: 30_000,
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['all-projects'],
    queryFn: listProjects,
    staleTime: 30_000,
  });

  const { data: assignees = [] } = useQuery<TaskAssignee[]>({
    queryKey: ['task-assignees', task.localId],
    queryFn: () => listAssigneesForTask(task.localId),
    staleTime: 30_000,
  });

  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleToggleDone = async () => {
    await updateTask(task.localId, { done: !task.done });
  };

  const handleDuplicate = async () => {
    const copy = await duplicateTask(task.localId);
    if (copy) setExpanded(null);
  };

  const handleMove = async (projectLocalId: string) => {
    await moveTask(task.localId, projectLocalId);
    setExpanded(null);
  };

  const handleToggleFavorite = async () => {
    await updateTask(task.localId, { isFavorite: !task.isFavorite });
  };

  const handleToggleSubscribe = async () => {
    if (!task.serverId) return;
    if (task.isSubscribed) {
      await unsubscribeFromTask(task.serverId, task.localId);
    } else {
      await subscribeToTask(task.serverId, task.localId);
    }
  };

  const handleAddAssignee = async (userServerId: number, username?: string) => {
    await addTaskAssignee(task.localId, userServerId, username);
    setExpanded(null);
  };

  const handleRemoveAssignee = async (userServerId: number) => {
    await removeTaskAssignee(task.localId, userServerId);
  };

  const handleDelete = async () => {
    await deleteTask(task.localId);
    onDeleted();
  };

  const handleDateChange = async (field: string, value: string | null) => {
    await updateTask(task.localId, { [field]: value } as any);
    setExpanded(null);
  };

  return (
    <div className="flex flex-col gap-1">
      {/* MARK TASK DONE */}
      <ActionButton
        icon={<CheckCircle2 className="h-4 w-4" />}
        label={task.done ? 'Mark not done' : 'Mark task done'}
        color={task.done ? 'var(--color-muted-foreground)' : '#22c55e'}
        onClick={handleToggleDone}
      />

      <SectionDivider />

      {/* ORGANIZATION */}
      <SectionHeader label="Organization" />

      <InlinePriority task={task} expanded={expanded === 'priority'} onToggle={() => setExpanded(expanded === 'priority' ? null : 'priority')} />
      <InlineProgress task={task} expanded={expanded === 'progress'} onToggle={() => setExpanded(expanded === 'progress' ? null : 'progress')} />
      <InlineColor task={task} expanded={expanded === 'color'} onToggle={() => setExpanded(expanded === 'color' ? null : 'color')} />
      <InlineLabels
        taskLocalId={task.localId}
        currentLabels={labels}
        allLabels={allLabels}
        expanded={expanded === 'labels'}
        onToggle={() => setExpanded(expanded === 'labels' ? null : 'labels')}
      />

      <SectionDivider />

      {/* FAVORITE + SUBSCRIBE */}
      <SectionHeader label="Preferences" />

      <ActionButton
        icon={<Star className={`h-4 w-4 ${task.isFavorite ? 'fill-current' : ''}`} />}
        label={task.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        color={task.isFavorite ? '#eab308' : undefined}
        onClick={handleToggleFavorite}
      />
      <ActionButton
        icon={<Bell className={`h-4 w-4 ${task.isSubscribed ? 'fill-current' : ''}`} />}
        label={task.isSubscribed ? 'Unsubscribe' : 'Subscribe'}
        color={task.isSubscribed ? '#3b82f6' : undefined}
        onClick={handleToggleSubscribe}
      />

      <SectionDivider />

      {/* DATE AND TIME */}
      <SectionHeader label="Date and Time" />

      <InlineDate
        icon={<Calendar className="h-4 w-4" />}
        label="Set due date"
        value={task.dueDate}
        onChange={(v) => handleDateChange('dueDate', v)}
        expanded={expanded === 'dueDate'}
        onToggle={() => setExpanded(expanded === 'dueDate' ? null : 'dueDate')}
      />
      <InlineDate
        icon={<Play className="h-4 w-4" />}
        label="Set start date"
        value={task.startDate}
        onChange={(v) => handleDateChange('startDate', v)}
        expanded={expanded === 'startDate'}
        onToggle={() => setExpanded(expanded === 'startDate' ? null : 'startDate')}
      />
      <InlineDate
        icon={<Square className="h-4 w-4" />}
        label="Set end date"
        value={task.endDate}
        onChange={(v) => handleDateChange('endDate', v)}
        expanded={expanded === 'endDate'}
        onToggle={() => setExpanded(expanded === 'endDate' ? null : 'endDate')}
      />

      <InlineRepeat
        task={task}
        expanded={expanded === 'repeat'}
        onToggle={() => setExpanded(expanded === 'repeat' ? null : 'repeat')}
      />

      <SectionDivider />

      {/* MANAGEMENT */}
      <SectionHeader label="Management" />

      <InlineAssignees
        assignees={assignees}
        expanded={expanded === 'assignees'}
        onToggle={() => setExpanded(expanded === 'assignees' ? null : 'assignees')}
        onRemove={handleRemoveAssignee}
        onAdd={handleAddAssignee}
      />

      <InlineMove projects={projects} expanded={expanded === 'move'} onToggle={() => setExpanded(expanded === 'move' ? null : 'move')} onMove={handleMove} />
      <ActionButton
        icon={<Copy className="h-4 w-4" />}
        label="Duplicate"
        onClick={handleDuplicate}
      />

      <SectionDivider />

      {/* DELETE */}
      {confirmDelete ? (
        <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
          <span className="text-xs text-red-600">Delete forever?</span>
          <button
            onClick={handleDelete}
            className="ml-auto rounded bg-red-600 px-2 py-0.5 text-[11px] text-white hover:bg-red-700"
          >
            Confirm
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <ActionButton
          icon={<Trash2 className="h-4 w-4" />}
          label="Delete"
          color="#ef4444"
          onClick={() => setConfirmDelete(true)}
        />
      )}
    </div>
  );
}

/* ─── Shared sub-components ─── */

// forwardRef so Radix-style `asChild` consumers (e.g. PopoverTrigger)
// can clone us and merge their own handlers + refs in. Without this,
// wrapping ActionButton in <PopoverTrigger asChild> would nest two
// <button>s or lose the ref.
const ActionButton = forwardRef<
  HTMLButtonElement,
  {
    icon: React.ReactNode;
    label: string;
    color?: string;
  } & ButtonHTMLAttributes<HTMLButtonElement>
>(({ icon, label, color, className, style, ...rest }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      'flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors hover:bg-[var(--color-accent)]/10',
      className,
    )}
    style={{ ...(color ? { color } : {}), ...style }}
    {...rest}
  >
    <span
      className="shrink-0"
      style={color ? { color } : { color: 'var(--color-muted-foreground)' }}
    >
      {icon}
    </span>
    {label}
  </button>
));
ActionButton.displayName = 'ActionButton';

function SectionDivider() {
  return <div className="my-1 border-t border-[var(--color-border)]" />;
}

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted-foreground)]">
      {label}
    </p>
  );
}

/* ─── Priority inline ─── */

function InlinePriority({
  task,
  expanded,
  onToggle,
}: {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
}) {
  const PRIORITY_LABELS = ['None', 'Low', 'Medium', 'High', 'Urgent', 'Critical'];

  return (
    <div>
      <ActionButton
        icon={<AlertTriangle className="h-4 w-4" />}
        label={`Priority: ${PRIORITY_LABELS[task.priority] ?? task.priority}`}
        onClick={onToggle}
      />
      {expanded && (
        <div className="mx-3 mb-1 flex gap-1">
          {[0, 1, 2, 3, 4, 5].map((p) => (
            <button
              key={p}
              onClick={async () => {
                await updateTask(task.localId, { priority: p });
              }}
              className={cn(
                'flex-1 rounded px-1 py-1 text-center text-[11px] transition-colors',
                p === task.priority
                  ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
                  : 'hover:bg-[var(--color-accent)]/10 text-[var(--color-muted-foreground)]',
              )}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Progress inline ─── */

function InlineProgress({
  task,
  expanded,
  onToggle,
}: {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [value, setValue] = useState(Math.round(task.percentDone * 100));

  useEffect(() => {
    setValue(Math.round(task.percentDone));
  }, [task.percentDone]);

  return (
    <div>
      <ActionButton
        icon={<Percent className="h-4 w-4" />}
        label={`Progress: ${Math.round(task.percentDone)}%`}
        onClick={onToggle}
      />
      {expanded && (
        <div className="mx-3 mb-1 flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            onMouseUp={async () => {
              await updateTask(task.localId, { percentDone: value });
            }}
            onTouchEnd={async () => {
              await updateTask(task.localId, { percentDone: value });
            }}
            className="flex-1"
          />
          <span className="w-8 text-right text-xs text-[var(--color-muted-foreground)]">
            {value}%
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Color inline ─── */

const COLOR_PRESETS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#78716c', '#000000',
];

function InlineColor({
  task,
  expanded,
  onToggle,
}: {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [customHex, setCustomHex] = useState(task.hexColor ?? '');

  const handleSelect = async (hex: string | null) => {
    await updateTask(task.localId, { hexColor: hex });
  };

  return (
    <div>
      <ActionButton
        icon={
          <span className="flex h-4 w-4 items-center justify-center">
            {task.hexColor ? (
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: task.hexColor }} />
            ) : (
              <Palette className="h-4 w-4" />
            )}
          </span>
        }
        label={task.hexColor ? `Color: ${task.hexColor}` : 'Set color'}
        onClick={onToggle}
      />
      {expanded && (
        <div className="mx-3 mb-1">
          <div className="mb-1.5 flex flex-wrap gap-1">
            {COLOR_PRESETS.map((hex) => (
              <button
                key={hex}
                onClick={() => handleSelect(hex === task.hexColor ? null : hex)}
                className={cn(
                  'h-5 w-5 rounded-full border-2 transition-all',
                  hex === task.hexColor
                    ? 'border-[var(--color-foreground)] scale-110'
                    : 'border-transparent hover:scale-110',
                )}
                style={{ background: hex }}
              />
            ))}
            <button
              onClick={() => handleSelect(null)}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] text-[10px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/10"
              title="Remove color"
            >
              ×
            </button>
          </div>
          <input
            type="text"
            value={customHex}
            onChange={(e) => setCustomHex(e.target.value)}
            onBlur={() => {
              if (customHex && /^#[0-9a-f]{6}$/i.test(customHex)) {
                handleSelect(customHex);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customHex && /^#[0-9a-f]{6}$/i.test(customHex)) {
                handleSelect(customHex);
              }
            }}
            placeholder="#rrggbb"
            className="w-full rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
          />
        </div>
      )}
    </div>
  );
}

/* ─── Labels inline ─── */

function InlineLabels({
  taskLocalId,
  currentLabels,
  allLabels,
  expanded,
  onToggle,
}: {
  taskLocalId: string;
  currentLabels: Label[];
  allLabels: Label[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const currentIds = new Set(currentLabels.map((l) => l.localId));

  const handleToggle = async (labelLocalId: string) => {
    await toggleTaskLabel(taskLocalId, labelLocalId);
  };

  return (
    <div>
      <ActionButton
        icon={<Tags className="h-4 w-4" />}
        label={
          currentLabels.length > 0
            ? `${currentLabels.length} label${currentLabels.length === 1 ? '' : 's'}`
            : 'Add labels'
        }
        onClick={onToggle}
      />
      {expanded && (
        <div className="mx-3 mb-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
          {allLabels.length === 0 && (
            <p className="py-1 text-[11px] text-[var(--color-muted-foreground)]">
              No labels available.
            </p>
          )}
          {allLabels.map((label) => {
            const active = currentIds.has(label.localId);
            return (
              <button
                key={label.localId}
                onClick={() => handleToggle(label.localId)}
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-1 text-left text-[11px] transition-colors',
                  active
                    ? 'bg-[var(--color-accent)]/10 font-medium'
                    : 'hover:bg-[var(--color-accent)]/5',
                )}
              >
                <span
                  className={cn(
                    'h-2.5 w-2.5 shrink-0 rounded-full border',
                    active ? 'border-current' : 'border-[var(--color-border)]',
                  )}
                  style={label.hexColor ? { background: label.hexColor } : undefined}
                />
                <span className="flex-1 truncate">{label.title}</span>
                {active && <span className="text-[10px] text-[var(--color-muted-foreground)]">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Date inline ─── */
//
// Wraps the action button in a Radix popover anchored against the
// sidebar; the popover hosts react-day-picker. The `expanded` /
// `onToggle` API is preserved for the surrounding TaskActions state
// machine so only one inline editor is open at a time.

function InlineDate({
  icon,
  label,
  value,
  onChange,
  expanded,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const display = value ? formatDateShort(value) : null;
  const selectedDate = value ? new Date(value) : undefined;

  return (
    <Popover
      open={expanded}
      onOpenChange={(open) => {
        if (open !== expanded) onToggle();
      }}
    >
      <PopoverTrigger asChild>
        <ActionButton
          icon={icon}
          label={display ? `${label}: ${display}` : label}
        />
      </PopoverTrigger>
      <PopoverContent align="start" side="left" sideOffset={8}>
        <CalendarGrid
          selected={selectedDate}
          onSelect={(d) => {
            // Persist as midnight UTC ISO so it round-trips with Vikunja's
            // date fields. Time-of-day is out of scope for M5's date
            // popover; bring it back in M8 with the recurrence work if
            // needed.
            if (!d) {
              onChange(null);
            } else {
              const iso = new Date(
                Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()),
              ).toISOString();
              onChange(iso);
            }
            onToggle();
          }}
          onClear={() => {
            onChange(null);
            onToggle();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/* ─── Move project inline ─── */

function InlineMove({
  projects,
  expanded,
  onToggle,
  onMove,
}: {
  projects: Project[];
  expanded: boolean;
  onToggle: () => void;
  onMove: (projectLocalId: string) => void;
}) {
  return (
    <div>
      <ActionButton
        icon={<ArrowLeftFromLine className="h-4 w-4" />}
        label="Move to project"
        onClick={onToggle}
      />
      {expanded && (
        <div className="mx-3 mb-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
          {projects.map((p) => (
            <button
              key={p.localId}
              onClick={() => onMove(p.localId)}
              className="flex items-center gap-2 rounded px-2 py-1 text-left text-[11px] transition-colors hover:bg-[var(--color-accent)]/10"
            >
              {p.hexColor && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: p.hexColor }}
                />
              )}
              <span className="truncate">{p.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Assignees inline ─── */

function InlineAssignees({
  assignees,
  expanded,
  onToggle,
  onRemove,
  onAdd,
}: {
  assignees: TaskAssignee[];
  expanded: boolean;
  onToggle: () => void;
  onRemove: (userServerId: number) => void;
  onAdd: (userServerId: number, username?: string) => void;
}) {
  const [addId, setAddId] = useState('');

  const handleAdd = () => {
    const id = Number(addId);
    if (!Number.isFinite(id) || id <= 0) return;
    onAdd(id);
    setAddId('');
  };

  return (
    <div>
      <ActionButton
        icon={<User className="h-4 w-4" />}
        label={
          assignees.length > 0
            ? `${assignees.length} assignee${assignees.length === 1 ? '' : 's'}`
            : 'Assign to user'
        }
        onClick={onToggle}
      />
      {expanded && (
        <div className="mx-3 mb-1 flex flex-col gap-1">
          {assignees.map((a) => (
            <div
              key={a.userServerId}
              className="flex items-center gap-2 rounded bg-[var(--color-accent)]/5 px-2 py-1 text-[11px]"
            >
              <span className="flex-1 truncate">{a.username ?? `User #${a.userServerId}`}</span>
              <button
                onClick={() => onRemove(a.userServerId)}
                className="text-red-500 hover:text-red-400"
              >
                ×
              </button>
            </div>
          ))}
          {assignees.length === 0 && (
            <p className="py-1 text-[11px] text-[var(--color-muted-foreground)]">
              No assignees
            </p>
          )}
          <div className="mt-1 flex items-center gap-1">
            <input
              type="number"
              value={addId}
              onChange={(e) => setAddId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="User ID"
              className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[11px]"
            />
            <button
              onClick={handleAdd}
              disabled={!addId}
              className="rounded bg-[var(--color-accent)] px-2 py-1 text-[11px] text-[var(--color-accent-foreground)] disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Repeat interval inline ─── */

const REPEAT_MODE_LABELS: Record<number, string> = {
  0: 'Repeat after (seconds)',
  1: 'Monthly',
  2: 'From current date',
};

function InlineRepeat({
  task,
  expanded,
  onToggle,
}: {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [repeatAfter, setRepeatAfter] = useState(task.repeatAfter);
  const [repeatMode, setRepeatMode] = useState(task.repeatMode);

  useEffect(() => {
    setRepeatAfter(task.repeatAfter);
    setRepeatMode(task.repeatMode);
  }, [task.repeatAfter, task.repeatMode]);

  const handleSave = async () => {
    await updateTask(task.localId, {
      repeatAfter: repeatAfter,
      repeatMode: repeatMode,
    });
  };

  return (
    <div>
      <ActionButton
        icon={<RefreshCw className="h-4 w-4" />}
        label={
          task.repeatAfter > 0
            ? `Repeats every ${formatDuration(task.repeatAfter)}`
            : 'Set repeating'
        }
        onClick={onToggle}
      />
      {expanded && (
        <div className="mx-3 mb-1 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={repeatAfter}
              onChange={(e) => setRepeatAfter(Number(e.target.value))}
              className="w-20 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[11px]"
            />
            <span className="text-[11px] text-[var(--color-muted-foreground)]">seconds</span>
          </div>
          <div className="flex gap-1">
            {[0, 1, 2].map((mode) => (
              <button
                key={mode}
                onClick={() => setRepeatMode(mode)}
                className={cn(
                  'flex-1 rounded px-1 py-1 text-center text-[10px] transition-colors',
                  mode === repeatMode
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
                    : 'hover:bg-[var(--color-accent)]/10 text-[var(--color-muted-foreground)]',
                )}
              >
                {REPEAT_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          <button
            onClick={handleSave}
            className="self-end rounded bg-[var(--color-accent)] px-3 py-1 text-[11px] text-[var(--color-accent-foreground)]"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}
