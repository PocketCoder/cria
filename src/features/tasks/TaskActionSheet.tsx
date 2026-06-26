import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CalendarDays,
  FolderInput,
  Target,
  Flag,
  CopyPlus,
  Link2,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useIsMobile } from '@/lib/useIsMobile';
import { useDisplay } from '@/stores/display';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { useSelectableProjects } from '@/queries/projects';
import { Calendar } from '@/components/ui/calendar';
import { PRIORITY_META } from '@/components/ui/priority-select';
import { updateTask, moveTask, duplicateTask } from '@/db/tasks';
import { getAuthSnapshot } from '@/auth/store';
import { toCalendarDate } from '@/lib/dateFormat';
import { impactDeleted } from '@/utils/haptics';
import type { Task } from '@/domain/task';

type Picker = 'schedule' | 'deadline' | 'move' | 'priority' | null;

export function TaskActionSheet() {
  const task = useDisplay((s) => s.actionTask);
  if (!task) return null;
  return <Inner key={task.localId} task={task} />;
}

function Inner({ task }: { task: Task }) {
  const isMobile = useIsMobile();
  const close = useDisplay((s) => s.closeActions);
  const startSelecting = useDisplay((s) => s.startSelecting);
  const enqueueDelete = usePendingDeletes((s) => s.enqueue);
  const { data: projects = [] } = useSelectableProjects();
  const [picker, setPicker] = useState<Picker>(null);

  const setDate = (field: 'dueDate' | 'endDate', d: Date | undefined) => {
    void updateTask(task.localId, { [field]: d ? d.toISOString() : null });
    close();
  };

  const body = picker ? (
    <div className="px-2 pb-2">
      {(picker === 'schedule' || picker === 'deadline') && (
        <Calendar
          selected={
            (picker === 'schedule' ? task.dueDate : task.endDate)
              ? toCalendarDate((picker === 'schedule' ? task.dueDate : task.endDate)!)
              : undefined
          }
          onSelect={(d) => setDate(picker === 'schedule' ? 'dueDate' : 'endDate', d)}
          onClear={() => setDate(picker === 'schedule' ? 'dueDate' : 'endDate', undefined)}
        />
      )}
      {picker === 'move' && (
        <div className="inset-list">
          {projects.map((p) => (
            <button
              key={p.localId}
              type="button"
              onClick={() => { void moveTask(task.localId, p.localId); close(); }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-base"
            >
              {p.hexColor && (
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.hexColor }} aria-hidden />
              )}
              <span className="flex-1 truncate">{p.title}</span>
              {task.projectLocalId === p.localId && <span className="text-[var(--color-primary)]">✓</span>}
            </button>
          ))}
        </div>
      )}
      {picker === 'priority' && (
        <div className="inset-list">
          {[...PRIORITY_META].reverse().map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => { void updateTask(task.localId, { priority: m.value }); close(); }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-base"
            >
              <Flag className="h-4 w-4 shrink-0" style={{ color: m.color }} />
              <span className="flex-1">{m.label}</span>
              {task.priority === m.value && <span className="text-[var(--color-primary)]">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  ) : (
    <div className="space-y-4 px-2 pb-2">
      <div className="inset-list">
        <ActionRow icon={CheckCircle2} label="Select Task" onClick={() => { startSelecting(task.localId); close(); }} />
      </div>
      <div className="inset-list">
        <ActionRow icon={CalendarDays} label="Schedule" chevron onClick={() => setPicker('schedule')} />
        <ActionRow icon={FolderInput} label="Move To…" chevron onClick={() => setPicker('move')} />
        <ActionRow icon={Target} label="Deadline" chevron onClick={() => setPicker('deadline')} />
        <ActionRow icon={Flag} label="Priority" chevron onClick={() => setPicker('priority')} />
      </div>
      <div className="inset-list">
        <ActionRow icon={CopyPlus} label="Duplicate Task" onClick={() => { void duplicateTask(task.localId); close(); }} />
        <ActionRow icon={Link2} label="Copy Link to Task" onClick={() => { copyTaskLink(task); close(); }} />
        <ActionRow icon={Trash2} label="Delete Task" destructive onClick={() => { enqueueDelete(task); impactDeleted(); close(); }} />
      </div>
    </div>
  );

  const header = (
    <div className="relative flex items-center justify-center px-3 py-2.5">
      {picker ? (
        <button
          type="button"
          aria-label="Back"
          onClick={() => setPicker(null)}
          className="absolute left-3 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-muted)]"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      ) : null}
      <h2 className="max-w-[70%] truncate text-sm font-semibold text-[var(--color-muted-foreground)]">
        {picker ? pickerTitle(picker) : task.title}
      </h2>
    </div>
  );

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Task actions">
        <div className="sheet-backdrop absolute inset-0" onClick={close} />
        <div className="safe-bottom relative z-10 flex max-h-[85vh] flex-col rounded-t-2xl bg-[var(--color-background)] pt-1 shadow-xl animate-[sheet-up_300ms_var(--spring-snappy)]">
          <div className="mx-auto mb-1 h-1 w-9 shrink-0 rounded-full bg-[var(--color-muted-foreground)]/30" />
          {header}
          <div className="min-h-0 overflow-y-auto">{body}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div className="w-full max-w-xs overflow-hidden rounded-xl bg-[var(--color-background)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {header}
        <div className="max-h-[70vh] overflow-y-auto">{body}</div>
      </div>
    </div>
  );
}

function pickerTitle(p: Exclude<Picker, null>): string {
  return p === 'schedule' ? 'Schedule' : p === 'deadline' ? 'Deadline' : p === 'move' ? 'Move to project' : 'Priority';
}

function ActionRow({
  icon: Icon,
  label,
  onClick,
  chevron,
  destructive,
}: {
  icon: typeof Flag;
  label: string;
  onClick: () => void;
  chevron?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3 text-left text-base',
        destructive ? 'text-[var(--color-destructive)]' : 'text-[var(--color-foreground)]',
      )}
    >
      <Icon className={cn('h-5 w-5 shrink-0', !destructive && 'text-[var(--color-muted-foreground)]')} />
      <span className="flex-1">{label}</span>
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />}
    </button>
  );
}

function copyTaskLink(task: Task) {
  const { serverUrl } = getAuthSnapshot();
  const text =
    task.serverId && serverUrl
      ? `${serverUrl.replace(/\/+$/, '')}/tasks/${task.serverId}`
      : task.title;
  void navigator.clipboard?.writeText(text).catch(() => {});
}
