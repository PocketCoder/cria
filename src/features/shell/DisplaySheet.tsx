import { useState } from 'react';
import {
  X,
  Check,
  ChevronRight,
  ChevronLeft,
  List,
  ArrowUpDown,
  Layers,
  Calendar,
  Target,
  Flag,
  Tag,
  FolderOpen,
  User,
} from 'lucide-react';
import { useIsMobile } from '@/lib/useIsMobile';
import { Switch } from '@/components/ui/switch';
import { useLabels } from '@/queries/labels';
import { useSelectableProjects } from '@/queries/projects';
import { PRIORITY_META } from '@/components/ui/priority-select';
import { useDisplay } from '@/stores/display';
import {
  sectionsFor,
  defaultConfigFor,
  type ViewKey,
  type DisplayConfig,
  type GroupBy,
  type DateFilter,
  type AssigneeFilter,
  type DisplaySort,
} from '@/lib/displayConfig';

/* ── option tables ────────────────────────────────────────────────────── */

const GROUP_CHOICES: { label: string; value: GroupBy }[] = [
  { label: 'None', value: 'none' },
  { label: 'Priority', value: 'priority' },
  { label: 'Date', value: 'dueDate' },
  { label: 'Project', value: 'project' },
  { label: 'Label', value: 'label' },
];

const SORT_CHOICES: { label: string; sort: DisplaySort }[] = [
  { label: 'Smart', sort: { field: 'smart', direction: 'asc' } },
  { label: 'Manual', sort: { field: 'manual', direction: 'asc' } },
  { label: 'Due date', sort: { field: 'dueDate', direction: 'asc' } },
  { label: 'Deadline', sort: { field: 'endDate', direction: 'asc' } },
  { label: 'Priority', sort: { field: 'priority', direction: 'desc' } },
  { label: 'Name', sort: { field: 'title', direction: 'asc' } },
  { label: 'Date added', sort: { field: 'created', direction: 'desc' } },
];

const DATE_CHOICES: { label: string; value: DateFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Today', value: 'today' },
  { label: 'This week', value: 'week' },
  { label: 'No date', value: 'none' },
];

const ASSIGNEE_CHOICES: { label: string; value: AssigneeFilter }[] = [
  { label: 'Default', value: 'all' },
  { label: 'Assigned to me', value: 'me' },
  { label: 'Unassigned', value: 'unassigned' },
];

type PickerId =
  | 'grouping'
  | 'sorting'
  | 'date'
  | 'deadline'
  | 'priority'
  | 'label'
  | 'project'
  | 'assignee';

/* ── value summaries (right-aligned grey text per row) ────────────────── */

const dateLabel = (v: DateFilter | undefined) =>
  DATE_CHOICES.find((c) => c.value === (v ?? 'all'))!.label;

function sortLabel(s: DisplaySort): string {
  return SORT_CHOICES.find((c) => c.sort.field === s.field)?.label ?? 'Smart';
}

/* ── the sheet ────────────────────────────────────────────────────────── */

export function DisplaySheet() {
  const sheetFor = useDisplay((s) => s.sheetFor);
  if (!sheetFor) return null;
  return <DisplaySheetInner key={sheetFor} viewKey={sheetFor} />;
}

function DisplaySheetInner({ viewKey }: { viewKey: ViewKey }) {
  const isMobile = useIsMobile();
  const close = useDisplay((s) => s.closeSheet);
  const setConfig = useDisplay((s) => s.setConfig);
  const stored = useDisplay((s) => s.configs[viewKey]);
  const config = stored ?? defaultConfigFor(viewKey);
  const sections = sectionsFor(viewKey);
  const [picker, setPicker] = useState<PickerId | null>(null);

  const patch = (p: Partial<DisplayConfig>) => setConfig(viewKey, p);

  const body = picker ? (
    <PickerScreen
      picker={picker}
      config={config}
      onBack={() => setPicker(null)}
      patch={patch}
    />
  ) : (
    <MainScreen
      config={config}
      sections={sections}
      patch={patch}
      openPicker={setPicker}
    />
  );

  const header = (
    <div className="relative flex items-center justify-center px-3 py-3">
      <button
        type="button"
        aria-label={picker ? 'Back' : 'Close'}
        onClick={() => (picker ? setPicker(null) : close())}
        className="absolute left-3 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-muted)] text-[var(--color-foreground)]"
      >
        {picker ? <ChevronLeft className="h-5 w-5" /> : <X className="h-5 w-5" />}
      </button>
      <h2 className="text-base font-semibold">{picker ? pickerTitle(picker) : 'Display'}</h2>
      {!picker && (
        <button
          type="button"
          aria-label="Done"
          onClick={close}
          className="absolute right-3 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-primary)] text-white"
        >
          <Check className="h-5 w-5" />
        </button>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Display options">
        <div className="sheet-backdrop absolute inset-0" onClick={close} />
        <div className="safe-bottom relative z-10 flex max-h-[92vh] flex-col rounded-t-2xl bg-[var(--color-background)] shadow-xl animate-[sheet-up_350ms_var(--spring-snappy)]">
          {header}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{body}</div>
        </div>
      </div>
    );
  }

  // Desktop: centered panel, same content.
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20" onClick={close}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-[var(--color-background)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">{body}</div>
      </div>
    </div>
  );
}

function pickerTitle(p: PickerId): string {
  switch (p) {
    case 'grouping': return 'Grouping';
    case 'sorting': return 'Sorting';
    case 'date': return 'Date';
    case 'deadline': return 'Deadline';
    case 'priority': return 'Priority';
    case 'label': return 'Label';
    case 'project': return 'Project';
    case 'assignee': return 'Assignee';
  }
}

/* ── main screen ──────────────────────────────────────────────────────── */

function MainScreen({
  config,
  sections,
  patch,
  openPicker,
}: {
  config: DisplayConfig;
  sections: ReturnType<typeof sectionsFor>;
  patch: (p: Partial<DisplayConfig>) => void;
  openPicker: (p: PickerId) => void;
}) {
  const f = config.filters;
  const countLabel = (n: number | undefined) => (n && n > 0 ? `${n} selected` : 'All');

  return (
    <div className="space-y-6">
      <Section>
        <Row icon={Layers} label="Completed Tasks">
          <Switch
            checked={config.showCompleted}
            onCheckedChange={(v) => patch({ showCompleted: v })}
          />
        </Row>
      </Section>

      {(sections.grouping || sections.sorting) && (
        <Section title="Sort">
          {sections.grouping && (
            <NavRow
              icon={Layers}
              label="Grouping"
              value={GROUP_CHOICES.find((c) => c.value === config.groupBy)!.label}
              onClick={() => openPicker('grouping')}
            />
          )}
          {sections.sorting && (
            <NavRow
              icon={ArrowUpDown}
              label="Sorting"
              value={sortLabel(config.sort)}
              onClick={() => openPicker('sorting')}
            />
          )}
        </Section>
      )}

      <Section title="Filter">
        {sections.filters.assignee && (
          <NavRow
            icon={User}
            label="Assignee"
            value={ASSIGNEE_CHOICES.find((c) => c.value === (f.assignee ?? 'all'))!.label}
            onClick={() => openPicker('assignee')}
          />
        )}
        {sections.filters.date && (
          <NavRow icon={Calendar} label="Date" value={dateLabel(f.dueDate)} onClick={() => openPicker('date')} />
        )}
        {sections.filters.deadline && (
          <NavRow icon={Target} label="Deadline" value={dateLabel(f.deadline)} onClick={() => openPicker('deadline')} />
        )}
        {sections.filters.priority && (
          <NavRow icon={Flag} label="Priority" value={countLabel(f.priority?.length)} onClick={() => openPicker('priority')} />
        )}
        {sections.filters.label && (
          <NavRow icon={Tag} label="Label" value={countLabel(f.labels?.length)} onClick={() => openPicker('label')} />
        )}
        {sections.filters.project && (
          <NavRow icon={FolderOpen} label="Project" value={countLabel(f.projects?.length)} onClick={() => openPicker('project')} />
        )}
      </Section>
    </div>
  );
}

/* ── secondary picker screen ──────────────────────────────────────────── */

function PickerScreen({
  picker,
  config,
  patch,
  onBack,
}: {
  picker: PickerId;
  config: DisplayConfig;
  patch: (p: Partial<DisplayConfig>) => void;
  onBack: () => void;
}) {
  const { data: labels = [] } = useLabels();
  const { data: projects = [] } = useSelectableProjects();
  const f = config.filters;

  if (picker === 'grouping') {
    return (
      <RadioList
        items={GROUP_CHOICES.map((c) => ({ key: c.value, label: c.label }))}
        selected={config.groupBy}
        onPick={(v) => { patch({ groupBy: v as GroupBy }); onBack(); }}
      />
    );
  }
  if (picker === 'sorting') {
    return (
      <RadioList
        items={SORT_CHOICES.map((c) => ({ key: c.sort.field, label: c.label }))}
        selected={config.sort.field}
        onPick={(field) => {
          const choice = SORT_CHOICES.find((c) => c.sort.field === field)!;
          patch({ sort: choice.sort });
          onBack();
        }}
      />
    );
  }
  if (picker === 'date' || picker === 'deadline') {
    const current = (picker === 'date' ? f.dueDate : f.deadline) ?? 'all';
    return (
      <RadioList
        items={DATE_CHOICES.map((c) => ({ key: c.value, label: c.label }))}
        selected={current}
        onPick={(v) => {
          patch({ filters: picker === 'date' ? { dueDate: v as DateFilter } : { deadline: v as DateFilter } });
          onBack();
        }}
      />
    );
  }
  if (picker === 'assignee') {
    return (
      <RadioList
        items={ASSIGNEE_CHOICES.map((c) => ({ key: c.value, label: c.label }))}
        selected={f.assignee ?? 'all'}
        onPick={(v) => { patch({ filters: { assignee: v as AssigneeFilter } }); onBack(); }}
      />
    );
  }
  if (picker === 'priority') {
    const selected = new Set(f.priority ?? []);
    return (
      <CheckList
        items={[...PRIORITY_META].reverse().map((m) => ({ key: String(m.value), label: m.label, color: m.color }))}
        selected={selected}
        onToggle={(key) => {
          const v = Number(key);
          const next = new Set(selected);
          next.has(v) ? next.delete(v) : next.add(v);
          patch({ filters: { priority: next.size ? [...next] : undefined } });
        }}
      />
    );
  }
  if (picker === 'label') {
    const selected = new Set(f.labels ?? []);
    return (
      <CheckList
        items={labels.map((l) => ({ key: l.title, label: l.title, color: l.hexColor ?? undefined }))}
        selected={selected}
        emptyMessage="No labels yet."
        onToggle={(key) => {
          const next = new Set(selected);
          next.has(key) ? next.delete(key) : next.add(key);
          patch({ filters: { labels: next.size ? [...next] : undefined } });
        }}
      />
    );
  }
  // project
  const selected = new Set(f.projects ?? []);
  return (
    <CheckList
      items={projects.map((p) => ({ key: p.title, label: p.title, color: p.hexColor ?? undefined }))}
      selected={selected}
      emptyMessage="No projects."
      onToggle={(key) => {
        const next = new Set(selected);
        next.has(key) ? next.delete(key) : next.add(key);
        patch({ filters: { projects: next.size ? [...next] : undefined } });
      }}
    />
  );
}

/* ── primitives ───────────────────────────────────────────────────────── */

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div>
      {title && (
        <h3 className="mb-1.5 px-1 text-footnote font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          {title}
        </h3>
      )}
      <div className="inset-list">{children}</div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof List;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
      <span className="flex-1 text-base">{label}</span>
      {children}
    </div>
  );
}

function NavRow({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: typeof List;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left">
      <Icon className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
      <span className="flex-1 text-base">{label}</span>
      <span className="text-sm text-[var(--color-muted-foreground)]">{value}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
    </button>
  );
}

function RadioList({
  items,
  selected,
  onPick,
}: {
  items: { key: string; label: string }[];
  selected: string;
  onPick: (key: string) => void;
}) {
  return (
    <div className="inset-list">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onPick(it.key)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <span className="flex-1 text-base">{it.label}</span>
          {selected === it.key && <Check className="h-5 w-5 text-[var(--color-primary)]" />}
        </button>
      ))}
    </div>
  );
}

function CheckList({
  items,
  selected,
  onToggle,
  emptyMessage,
}: {
  items: { key: string; label: string; color?: string }[];
  selected: Set<string | number>;
  onToggle: (key: string) => void;
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return <p className="px-4 py-6 text-sm text-[var(--color-muted-foreground)]">{emptyMessage ?? 'Nothing to show.'}</p>;
  }
  return (
    <div className="inset-list">
      {items.map((it) => {
        const on = selected.has(it.key) || selected.has(Number(it.key));
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onToggle(it.key)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            {it.color && (
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: it.color }} aria-hidden />
            )}
            <span className="flex-1 text-base">{it.label}</span>
            {on && <Check className="h-5 w-5 text-[var(--color-primary)]" />}
          </button>
        );
      })}
    </div>
  );
}
