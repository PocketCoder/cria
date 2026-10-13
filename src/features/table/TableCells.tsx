import { cn } from '@/lib/cn';
import { PrioritySelect } from '@/components/ui/priority-select';
import { priorityColor } from '@/components/ui/priority';
import { updateTask } from '@/db/tasks';
import { playCompletionSound } from '@/utils/sound';
import type { Task } from '@/domain/task';
import type { ColumnKey } from './useTableConfig';
import { DateCell } from './DateCell';
import { LabelCell } from './LabelCell';
import { LabelEditCell } from './LabelEditCell';
import { AssigneeCell } from './AssigneeCell';
import {
  DATE_COLUMN_FIELD,
  clampPercent,
  createdByLabel,
  fromDateInputValue,
  taskIndexLabel,
  toDateInputValue,
  type DraftFields,
} from './tableLogic';

/* ───────────────────────── cells ───────────────────────── */

export function Cell({
  task,
  columnKey,
  projectTitle,
  currentUserServerId,
}: {
  task: Task;
  columnKey: ColumnKey;
  projectTitle: (id: string) => string;
  currentUserServerId: number | null;
}) {
  if (columnKey in DATE_COLUMN_FIELD) {
    const field = DATE_COLUMN_FIELD[columnKey as keyof typeof DATE_COLUMN_FIELD];
    return <DateCell value={task[field]} />;
  }
  switch (columnKey) {
    case 'index':
      return (
        <span className="tabular-nums text-[var(--color-muted-foreground)]">
          {taskIndexLabel(task)}
        </span>
      );
    case 'done':
      return <DoneCheckbox task={task} />;
    case 'project':
      return <span className="truncate">{projectTitle(task.projectLocalId) || '—'}</span>;
    case 'title':
      return <TitleCell task={task} />;
    case 'priority':
      return <PriorityCell priority={task.priority} />;
    case 'labels':
      return <LabelCell taskLocalId={task.localId} />;
    case 'assignees':
      return <AssigneeCell taskLocalId={task.localId} />;
    case 'createdBy':
      return (
        <span className="text-[var(--color-muted-foreground)]">
          {createdByLabel(task.createdById, currentUserServerId)}
        </span>
      );
    case 'percentDone':
      return <PercentCell value={task.percentDone} />;
    default:
      return null;
  }
}

function TitleCell({ task }: { task: Task }) {
  return (
    <span
      className={cn(
        'block max-w-[28rem] truncate',
        task.done && 'line-through text-[var(--color-muted-foreground)]',
      )}
      title={task.title}
    >
      {task.title}
    </span>
  );
}

function PriorityCell({ priority }: { priority: number }) {
  return priority > 2 ? (
    <span aria-label={`Priority ${priority}`} style={{ color: priorityColor(priority) }}>
      {'!'.repeat(Math.min(5, priority))}
    </span>
  ) : (
    <span className="text-[var(--color-muted-foreground)]">—</span>
  );
}

/* ───────────────────────── inline edit fields ───────────────────────── */

const EDIT_INPUT_CLS =
  'w-full rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-ring)]';

/**
 * The editable form control for one cell while the table is in edit mode.
 * Reads its value from the row's draft (falling back to the task) and reports
 * changes up to the table's draft state. Native `<input type="date">` avoids a
 * custom popover.
 */
export function EditField({
  task,
  columnKey,
  draft,
  onChange,
}: {
  task: Task;
  columnKey: ColumnKey;
  draft: DraftFields | undefined;
  onChange: (field: keyof DraftFields, value: unknown) => void;
}) {
  switch (columnKey) {
    case 'labels':
      // Labels are a relation, not a draft field — toggled immediately.
      return <LabelEditCell taskLocalId={task.localId} />;
    case 'title':
      return (
        <input
          aria-label="Title"
          type="text"
          value={draft?.title ?? task.title}
          onChange={(e) => onChange('title', e.target.value)}
          className={EDIT_INPUT_CLS}
        />
      );
    case 'priority':
      return (
        <PrioritySelect
          value={draft?.priority ?? task.priority}
          onChange={(p) => onChange('priority', p)}
          compact
        />
      );
    case 'percentDone':
      return (
        <input
          aria-label="Percent done"
          type="number"
          min={0}
          max={100}
          step={5}
          value={draft?.percentDone ?? task.percentDone}
          onChange={(e) => onChange('percentDone', clampPercent(e.target.valueAsNumber))}
          className={EDIT_INPUT_CLS}
        />
      );
    case 'dueDate':
    case 'startDate':
    case 'endDate': {
      const current = task[columnKey];
      const draftVal = draft?.[columnKey];
      const value = draftVal !== undefined ? draftVal : current;
      return (
        <input
          aria-label={columnKey === 'dueDate' ? 'Due date' : columnKey === 'startDate' ? 'Start date' : 'End date'}
          type="date"
          value={toDateInputValue(value)}
          onChange={(e) => onChange(columnKey, fromDateInputValue(e.target.value, value))}
          className={EDIT_INPUT_CLS}
        />
      );
    }
    default:
      return null;
  }
}

function DoneCheckbox({ task }: { task: Task }) {
  const handleToggle = async () => {
    const nowDone = !task.done;
    try {
      await updateTask(task.localId, { done: nowDone });
      if (nowDone) playCompletionSound();
    } catch (err) {
      console.error('[table] failed to toggle done:', err);
    }
  };
  return (
    <input
      type="checkbox"
      checked={task.done}
      onChange={handleToggle}
      onClick={(e) => e.stopPropagation()}
      aria-label={task.title}
      className="h-4 w-4 cursor-pointer rounded accent-[var(--color-primary)]"
    />
  );
}

function PercentCell({ value }: { value: number }) {
  if (!value) return <span className="text-[var(--color-muted-foreground)]">—</span>;
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-border)]">
        <span
          className="block h-full rounded-full bg-[var(--color-primary)]"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </span>
      <span className="tabular-nums text-caption">{Math.round(value)}%</span>
    </span>
  );
}
