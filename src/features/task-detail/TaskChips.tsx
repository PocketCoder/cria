import { forwardRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Calendar as CalendarIcon, Check, ChevronRight } from 'lucide-react';
import { listProjects } from '@/db/projects';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { PriorityList } from '@/components/ui/priority-select';
import { PRIORITY_LABELS, priorityColor } from '@/components/ui/priority';
import { COLOR_PRESETS } from '@/lib/colorPresets';
import { dueCalendarDate, toCalendarDate } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type { Task } from '@/domain/task';
import type { Label } from '@/domain/label';
import type { Project } from '@/domain/project';
import { formatDueChip, pickDayIso, type Picker } from './taskDetailLogic';

type DateField = 'dueDate' | 'startDate' | 'endDate';
type OnSetDate = (field: DateField, value: string | null) => Promise<void>;
type OnToggleLabel = (labelLocalId: string) => Promise<void>;

// forwardRef + prop spread: Radix `PopoverTrigger asChild` needs the ref to
// anchor the popover and passes aria/data-state props through.
const Chip = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { dashed?: boolean }
>(function Chip({ children, dashed = false, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
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
});

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

export function ChipRow({
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
  onToggleLabel: OnToggleLabel;
  onSetDate: OnSetDate;
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
            selected={task.dueDate ? dueCalendarDate(task.dueDate) : undefined}
            onSelect={(date) => {
              void onSetDate('dueDate', pickDayIso(date, task.dueDate));
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
        <PopoverContent align="start" sideOffset={6} className="w-40 p-1">
          <PriorityList
            value={task.priority}
            onChange={(p) => void onSetPriority(p)}
            onPicked={() => setPicker(null)}
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
  onToggleLabel: OnToggleLabel;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-56 p-1">
        <LabelList labels={labels} allLabels={allLabels} onToggleLabel={onToggleLabel} />
      </PopoverContent>
    </Popover>
  );
}

type AddView = 'menu' | 'start' | 'end' | 'colour' | 'label';

const ADD_MENU_ITEMS = [
  { key: 'start' as const, label: 'Start date' },
  { key: 'end' as const, label: 'End date' },
  { key: 'colour' as const, label: 'Colour' },
  { key: 'label' as const, label: 'Label' },
];

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
  onToggleLabel: OnToggleLabel;
  onSetDate: OnSetDate;
  onSetColor: (hex: string) => void;
  task: Task;
  picker: Picker;
  setPicker: (p: Picker) => void;
}) {
  const [viewState, setView] = useState<AddView>('menu');
  const [openState, setOpen] = useState(false);

  // The `label` / `colour` keyboard shortcuts route through `picker`: open the
  // popover straight to that sub-view instead of the menu. Derived from the
  // prop (no effect) so there is no stale first paint.
  const forced = picker === 'label' || picker === 'colour' ? picker : null;
  const view = forced ?? viewState;
  const open = openState || forced !== null;

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
        <AddChipView
          view={view}
          setView={setView}
          task={task}
          labels={labels}
          allLabels={allLabels}
          onToggleLabel={onToggleLabel}
          onSetDate={onSetDate}
          onSetColor={onSetColor}
        />
      </PopoverContent>
    </Popover>
  );
}

function AddChipView({
  view,
  setView,
  task,
  labels,
  allLabels,
  onToggleLabel,
  onSetDate,
  onSetColor,
}: {
  view: AddView;
  setView: (v: AddView) => void;
  task: Task;
  labels: Label[];
  allLabels: Label[];
  onToggleLabel: OnToggleLabel;
  onSetDate: OnSetDate;
  onSetColor: (hex: string) => void;
}) {
  if (view === 'menu') {
    return (
      <div className="flex flex-col">
        {ADD_MENU_ITEMS.map((item) => (
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
    );
  }
  if (view === 'colour') {
    return <ColourPicker current={task.hexColor} onSetColor={onSetColor} />;
  }
  if (view === 'label') {
    return <LabelList labels={labels} allLabels={allLabels} onToggleLabel={onToggleLabel} />;
  }
  const field = view === 'start' ? 'startDate' : 'endDate';
  const currentIso = view === 'start' ? task.startDate : task.endDate;
  // No extra padding: the 252px calendar only just fits the w-64 popover.
  return (
    <div>
      <Calendar
        selected={currentIso ? toCalendarDate(currentIso) : undefined}
        onSelect={(date) => {
          void onSetDate(field, pickDayIso(date, currentIso));
        }}
        onClear={() => void onSetDate(field, null)}
      />
    </div>
  );
}

function ColourPicker({
  current,
  onSetColor,
}: {
  current: string | null;
  onSetColor: (hex: string) => void;
}) {
  return (
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
              current === hex && 'ring-2 ring-[var(--color-ring)]',
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
  );
}

function LabelList({
  labels,
  allLabels,
  onToggleLabel,
}: {
  labels: Label[];
  allLabels: Label[];
  onToggleLabel: OnToggleLabel;
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
