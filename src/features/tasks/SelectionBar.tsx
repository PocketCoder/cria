import { useState } from 'react';
import { Check, CalendarDays, FolderInput, Flag, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDisplay } from '@/stores/display';
import { usePendingDeletes } from '@/stores/pendingDeletes';
import { useSelectableProjects } from '@/queries/projects';
import { Calendar } from '@/components/ui/calendar';
import { PRIORITY_META } from '@/components/ui/priority-select';
import { updateTask, moveTask, getTaskByLocalId } from '@/db/tasks';
import { impactComplete, impactDeleted } from '@/utils/haptics';

type Picker = 'schedule' | 'move' | 'priority' | null;

/**
 * Bulk-action bar shown while multi-select is active. Operates on the selected
 * task ids: complete, schedule, move, set priority, delete. Sits above the tab
 * bar on mobile / bottom-centre on desktop.
 */
export function SelectionBar() {
  const selecting = useDisplay((s) => s.selecting);
  const selected = useDisplay((s) => s.selected);
  const stop = useDisplay((s) => s.stopSelecting);
  const enqueueDelete = usePendingDeletes((s) => s.enqueue);
  const { data: projects = [] } = useSelectableProjects();
  const [picker, setPicker] = useState<Picker>(null);

  if (!selecting) return null;
  const ids = Object.keys(selected);

  const eachUpdate = async (patch: Parameters<typeof updateTask>[1]) => {
    await Promise.all(ids.map((id) => updateTask(id, patch).catch(() => {})));
  };

  const complete = () => { void eachUpdate({ done: true }).then(() => { impactComplete(); stop(); }); };
  const schedule = (d: Date | undefined) => { void eachUpdate({ dueDate: d ? d.toISOString() : null }).then(stop); };
  const setPriority = (p: number) => { void eachUpdate({ priority: p }).then(stop); };
  const move = (projectLocalId: string) => {
    void Promise.all(ids.map((id) => moveTask(id, projectLocalId).catch(() => {}))).then(stop);
  };
  const remove = () => {
    void Promise.all(
      ids.map(async (id) => {
        const t = await getTaskByLocalId(id);
        if (t) enqueueDelete(t);
      }),
    ).then(() => { impactDeleted(); stop(); });
  };

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
    >
      <div className="pointer-events-auto w-full max-w-md rounded-2xl bg-[var(--color-card)] p-2 shadow-xl ring-1 ring-[var(--color-border)]">
        {picker === 'schedule' && (
          <div className="px-1 pb-1">
            <Calendar onSelect={(d) => schedule(d)} onClear={() => schedule(undefined)} />
          </div>
        )}
        {picker === 'move' && (
          <div className="max-h-56 overflow-y-auto">
            {projects.map((p) => (
              <button
                key={p.localId}
                type="button"
                onClick={() => move(p.localId)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--color-muted)]"
              >
                {p.hexColor && <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.hexColor }} />}
                <span className="truncate">{p.title}</span>
              </button>
            ))}
          </div>
        )}
        {picker === 'priority' && (
          <div className="max-h-56 overflow-y-auto">
            {[...PRIORITY_META].reverse().map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setPriority(m.value)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--color-muted)]"
              >
                <Flag className="h-4 w-4" style={{ color: m.color }} />
                {m.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-[var(--color-muted-foreground)]"
          >
            <X className="h-4 w-4" />
            {ids.length}
          </button>
          <div className="flex items-center gap-0.5">
            <BarBtn icon={Check} label="Complete" disabled={!ids.length} onClick={complete} />
            <BarBtn icon={CalendarDays} label="Schedule" disabled={!ids.length} active={picker === 'schedule'} onClick={() => setPicker(picker === 'schedule' ? null : 'schedule')} />
            <BarBtn icon={FolderInput} label="Move" disabled={!ids.length} active={picker === 'move'} onClick={() => setPicker(picker === 'move' ? null : 'move')} />
            <BarBtn icon={Flag} label="Priority" disabled={!ids.length} active={picker === 'priority'} onClick={() => setPicker(picker === 'priority' ? null : 'priority')} />
            <BarBtn icon={Trash2} label="Delete" disabled={!ids.length} destructive onClick={remove} />
          </div>
        </div>
      </div>
    </div>
  );
}

function BarBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  destructive,
}: {
  icon: typeof Flag;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-lg transition-colors disabled:opacity-40',
        active && 'bg-[var(--color-primary)]/10',
        destructive ? 'text-[var(--color-destructive)]' : 'text-[var(--color-foreground)]',
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
