import { useState, type ReactNode } from 'react';
import { CalendarDays, Tag, Bell } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { PrioritySelect } from '@/components/ui/priority-select';
import { priorityColor } from '@/components/ui/priority';
import { DatePicker } from '@/components/DatePicker';
import { LabelPicker } from '@/components/ui/label-picker';
import { RecurrencePicker } from '@/components/ui/recurrence-picker';
import { ReminderPill } from '@/components/ui/reminder-pill';
import { Popover, PopoverTrigger, PopoverContent, pickerChipClass } from '@/components/ui/popover';
import { formatDue } from '@/features/tasks/taskRowHelpers';
import { cn } from '@/lib/cn';
import { repeatLabel } from '@/lib/repeatLabel';
import { resolveProjectChip } from '@/lib/quickAddProject';
import type { QuickAddResult } from '@/lib/quickAddParser';
import type { AddReminderInput } from '@/db/reminders';
import type { Project } from '@/domain/project';

interface SetChipsProps {
  parsed: QuickAddResult;
  projects: Project[];
  projectId: string | null;
  setProjectId: (v: string | null) => void;
  dueDate: string | null;
  setDueDate: (v: string | null) => void;
  priority: number;
  setPriority: (v: number) => void;
  labelTitles: string[];
  setLabelTitles: (v: string[]) => void;
  reminders: AddReminderInput[];
  setReminders: (v: AddReminderInput[]) => void;
  repeatAfter: number | null;
  repeatMode: number | null;
  onChangeRepeat: (after: number | null, mode: number | null) => void;
  className?: string;
  /** Content of the dashed affordance chip. Defaults to `+ Priority, labels…`. */
  placeholder?: ReactNode;
}

/**
 * The "only what is actually set" chip row + the dashed `+ Priority,
 * labels…` chip that opens the full picker set in a popover. Every chip is a
 * trigger, so tapping a set chip re-opens the pickers to edit it.
 */
export function SetChips({ className, placeholder, ...props }: SetChipsProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <div
          className={cn(
            'flex cursor-pointer flex-wrap items-center gap-1.5',
            className,
          )}
        >
          <ChipList {...props} />
          <span className="chip-dashed">{placeholder ?? '+ Priority, labels…'}</span>
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-max max-w-[320px]">
        <PickerSet {...props} />
      </PopoverContent>
    </Popover>
  );
}

function ChipList({
  parsed,
  projects,
  projectId,
  dueDate,
  priority,
  labelTitles,
  reminders,
  repeatAfter,
  repeatMode,
}: SetChipsProps) {
  const { title: resolvedProject, color: resolvedProjectColor } = resolveProjectChip(
    parsed.projectTitle,
    projects,
    projectId,
  );

  return (
    <>
      {dueDate ? (
        <span className="chip">
          <CalendarDays className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          {formatDue(dueDate)}
        </span>
      ) : null}
      {priority > 0 ? (
        <span className="chip">
          <span
            className="h-3 w-[3px] rounded-full"
            style={{ backgroundColor: priorityColor(priority) }}
          />
          !{priority}
        </span>
      ) : null}
      {labelTitles.map((t) => (
        <span key={t} className="chip">
          <Tag className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          {t}
        </span>
      ))}
      {reminders.length > 0 ? (
        <span className="chip">
          <Bell className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          {reminders.length} reminder{reminders.length === 1 ? '' : 's'}
        </span>
      ) : null}
      {repeatAfter !== null || repeatMode !== null ? (
        <span className="chip">{repeatLabel(repeatAfter, repeatMode)}</span>
      ) : null}
      {resolvedProject ? (
        <span className="chip">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--color-border)]"
            style={resolvedProjectColor ? { backgroundColor: resolvedProjectColor } : undefined}
          />
          {resolvedProject}
        </span>
      ) : null}
    </>
  );
}

function PickerSet({
  projects,
  projectId,
  setProjectId,
  dueDate,
  setDueDate,
  priority,
  setPriority,
  labelTitles,
  setLabelTitles,
  reminders,
  setReminders,
  repeatAfter,
  repeatMode,
  onChangeRepeat,
}: SetChipsProps) {
  // One picker open at a time: opening another chip closes the current one.
  // The functional update keeps a late close from the old picker from
  // clobbering the new one.
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const pickerOpen = (key: string) => ({
    open: openPicker === key,
    onOpenChange: (o: boolean) =>
      setOpenPicker((cur) => (o ? key : cur === key ? null : cur)),
  });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <DatePicker
        value={dueDate}
        onChange={setDueDate}
        placeholder="Date"
        enableTime
        smart
        {...pickerOpen('date')}
      />
      <LabelPicker value={labelTitles} onChange={setLabelTitles} {...pickerOpen('labels')} />
      <PrioritySelect
        value={priority}
        onChange={setPriority}
        variant="pill"
        {...pickerOpen('priority')}
      />
      <ReminderPill value={reminders} onChange={setReminders} {...pickerOpen('reminders')} />
      <RecurrencePicker
        repeatAfter={repeatAfter}
        repeatMode={repeatMode}
        onChange={onChangeRepeat}
        {...pickerOpen('repeat')}
      />
      {projects.length > 0 ? (
        <ProjectPicker
          projects={projects}
          projectId={projectId}
          setProjectId={setProjectId}
          {...pickerOpen('project')}
        />
      ) : null}
    </div>
  );
}

function ProjectPicker({
  projects,
  projectId,
  setProjectId,
  open,
  onOpenChange,
}: Pick<SetChipsProps, 'projects' | 'projectId' | 'setProjectId'> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Select
      value={projectId ?? ''}
      onValueChange={(v) => setProjectId(v || null)}
      open={open}
      onOpenChange={onOpenChange}
    >
      <SelectTrigger
        className={cn(pickerChipClass, 'h-auto w-auto min-w-0 justify-start [&>span]:truncate')}
        aria-label="Project"
      >
        <SelectValue placeholder="Inbox" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.localId} value={p.localId}>
            <span className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--color-border)]"
                style={p.hexColor ? { backgroundColor: p.hexColor } : undefined}
              />
              {p.title}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
