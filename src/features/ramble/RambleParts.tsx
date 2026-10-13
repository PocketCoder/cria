import { useMemo, type ReactNode } from 'react';
import {
  Mic,
  Pause,
  Check,
  CheckCheck,
  Loader2,
  X,
  Trash2,
  Sparkles,
  Calendar,
  Repeat,
  Tag,
  Flag,
  Folder,
} from 'lucide-react';
import { parseQuickAdd } from '@/lib/quickAddParser';
import { useSettings } from '@/stores/settings';
import { hasTimeOfDay, useDateFormatter } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { priorityColor } from '@/components/ui/priority';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { Project } from '@/domain/project';
import {
  hasTitle,
  hasUsableSuggestion,
  projectPreview,
  usableSuggestion,
  type Draft,
  type Phase,
  type SuggestionContext,
} from './rambleLogic';

export function RambleHeader({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Mic className="h-4 w-4" />
        Ramble
      </h2>
      <button
        onClick={onClose}
        disabled={busy}
        className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-50 disabled:hover:text-[var(--color-muted-foreground)]"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

const WAVE_BARS = 28;

/** Decorative level meter: the native bridge sends no audio levels, so it just moves while listening. */
function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex h-8 flex-1 items-center justify-center gap-[3px]" aria-hidden>
      {Array.from({ length: WAVE_BARS }, (_, i) => (
        <span
          key={i}
          className={cn(
            'w-[3px] rounded-full bg-[var(--color-primary)] transition-opacity',
            active ? 'animate-[ramble-wave_900ms_ease-in-out_infinite] motion-reduce:animate-none' : 'opacity-30',
          )}
          style={{
            height: active ? undefined : 4,
            animationDelay: `${(i * 67) % 600}ms`,
            opacity: active ? 0.35 + ((i * 37) % 65) / 100 : undefined,
          }}
        />
      ))}
    </div>
  );
}

/** Voice-only review: task cards as you speak, a status line, and the pause / waveform / confirm bar. */
export function RambleReview({
  phase,
  drafts,
  chosenCount,
  projects,
  projectId,
  setProjectId,
  error,
  onUpdate,
  onDelete,
  onAddAll,
  adding,
  listening,
  interim,
  organising,
  busyIds,
  onMic,
  onAddOne,
  onAccept,
  onAcceptAll,
  suggestionCtx,
}: {
  onAccept: (id: number) => void;
  onAcceptAll: () => void;
  suggestionCtx: SuggestionContext;
  adding: boolean;
  listening: boolean;
  interim: string;
  organising: boolean;
  busyIds: ReadonlySet<number>;
  onMic: () => void;
  onAddOne: (id: number) => void;
  phase: Phase;
  drafts: Draft[];
  chosenCount: number;
  projects: Project[];
  projectId: string;
  setProjectId: (id: string) => void;
  error: string | null;
  onUpdate: (id: number, patch: Partial<Draft>) => void;
  onDelete: (id: number) => void;
  onAddAll: () => void;
}) {
  const saving = phase === 'saving';
  // Add-all pressed: waiting for speech to settle, or saving.
  const busyAll = saving || adding;
  // Speech still being heard or turned into rows: adding now would leave out
  // tasks the user hasn't seen yet.
  const settling = organising || interim !== '';
  const suggestionCount = drafts.filter((d) => hasUsableSuggestion(d, suggestionCtx)).length;
  const status = busyAll
    ? 'Adding…'
    : settling
      ? 'Working on it…'
      : listening
        ? 'Listening…'
        : drafts.length > 0
          ? 'Paused'
          : 'Tap the mic to start';
  return (
    <div className="space-y-3">
      <Select value={projectId} onValueChange={setProjectId}>
        <SelectTrigger
          className="mx-auto flex w-auto min-w-40 max-w-full items-center justify-center gap-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold hover:border-[var(--color-border)]"
          aria-label="Project for new tasks"
        >
          <SelectValue placeholder="Select project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.localId} value={p.localId}>
              {p.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {suggestionCount > 0 && (
        <button
          type="button"
          onClick={onAcceptAll}
          disabled={saving}
          className="mx-auto flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1 text-caption text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3" /> Accept all suggestions ({suggestionCount})
        </button>
      )}

      <ul className="max-h-[45dvh] min-h-24 space-y-2 overflow-y-auto pr-1">
        {drafts.map((d) => (
          <DraftRow
            key={d.id}
            draft={d}
            projects={projects}
            fallbackProjectId={projectId}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onAdd={onAddOne}
            onAccept={onAccept}
            suggestionCtx={suggestionCtx}
            busy={saving || busyIds.has(d.id)}
          />
        ))}
        {(listening || settling) && (
          <li
            className="flex items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-card)] px-3 py-3"
          >
            <span className="h-5 w-5 shrink-0 rounded-full border-2 border-[var(--color-border)]" />
            {interim ? (
              <span className="text-sm italic text-[var(--color-muted-foreground)]">{interim}</span>
            ) : (
              <span className="h-3 flex-1 animate-pulse rounded bg-[var(--color-muted)]" />
            )}
          </li>
        )}
      </ul>

      <div className="space-y-0.5 text-center" aria-live="polite">
        <p className="text-sm font-medium">{status}</p>
        <p className="text-caption text-[var(--color-muted-foreground)]">
          Say everything you need to get done.
        </p>
      </div>

      {error && <p className="text-center text-caption text-[var(--color-destructive)]">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={onMic}
          disabled={busyAll}
          aria-label={listening ? 'Pause listening' : 'Start listening'}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-muted)] text-[var(--color-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {listening ? <Pause className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <button
          type="button"
          disabled={busyAll || chosenCount === 0 || !projectId}
          onClick={onAddAll}
          aria-label={`Add all ${chosenCount} tasks`}
          title="Add all"
          className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {busyAll ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCheck className="h-5 w-5" />}
          {chosenCount > 0 && !busyAll && (
            <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[var(--color-foreground)] px-1 text-center text-[11px] font-semibold leading-5 text-[var(--color-background)]">
              {chosenCount}
            </span>
          )}
        </button>
        <Waveform active={listening && !busyAll} />
      </div>
    </div>
  );
}

function DraftRow({
  draft: d,
  projects,
  fallbackProjectId,
  onUpdate,
  onDelete,
  onAdd,
  onAccept,
  suggestionCtx,
  busy,
}: {
  onAccept: (id: number) => void;
  suggestionCtx: SuggestionContext;
  draft: Draft;
  projects: Project[];
  fallbackProjectId: string;
  onUpdate: (id: number, patch: Partial<Draft>) => void;
  onDelete: (id: number) => void;
  onAdd: (id: number) => void;
  busy: boolean;
}) {
  const mode = useSettings((s) => s.quickAddMagicMode);
  const priority = useMemo(() => parseQuickAdd(d.line, new Date(), mode).priority, [d.line, mode]);
  return (
    <li className="group flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 shadow-sm">
      <span
        className="mt-1.5 h-5 w-5 shrink-0 rounded-full border-2"
        style={{ borderColor: priority ? priorityColor(priority) : 'var(--color-border)' }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <input
          aria-label="Task"
          type="text"
          value={d.line}
          onChange={(e) => onUpdate(d.id, { line: e.target.value })}
          className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-sm hover:border-[var(--color-border)] focus:border-[var(--color-ring)] focus:outline-none"
        />
        <DraftChips
          line={d.line}
          included
          projects={projects}
          fallbackProjectId={fallbackProjectId}
        />
        {d.notes && (
          <p className="line-clamp-2 px-1 pb-1 text-caption text-[var(--color-muted-foreground)]">{d.notes}</p>
        )}
        {d.suggestion && <SuggestionRow draft={d} ctx={suggestionCtx} busy={busy} onAccept={onAccept} />}
      </div>
      <button
        type="button"
        onClick={() => onAdd(d.id)}
        disabled={busy || !hasTitle(d.line, mode)}
        className="mt-1 shrink-0 rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] disabled:opacity-40"
        aria-label={`Add ${d.line} now`}
        title="Add this task now"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => onDelete(d.id)}
        className="mt-1 shrink-0 rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
        aria-label={`Remove ${d.line}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/** Model-suggested project and labels: shown, but only applied when accepted. */
function SuggestionRow({
  draft: d,
  ctx,
  busy,
  onAccept,
}: {
  draft: Draft;
  ctx: SuggestionContext;
  busy: boolean;
  onAccept: (id: number) => void;
}) {
  // Only existing projects/labels the line doesn't already set are offered.
  const u = usableSuggestion(d, ctx);
  // Typed, so a project and a label that share a name stay two distinct chips.
  const items = [
    ...(u.project ? [{ kind: 'project' as const, name: u.project }] : []),
    ...u.labels.map((name) => ({ kind: 'label' as const, name })),
  ];
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 px-2 pb-1">
      <Sparkles className="h-3 w-3 text-[var(--color-muted-foreground)]" aria-hidden />
      {items.map((it) => (
        <span
          key={`${it.kind}:${it.name}`}
          title={`${it.kind === 'project' ? 'Project' : 'Label'}: ${it.name}`}
          aria-label={`${it.kind === 'project' ? 'Project' : 'Label'} ${it.name}`}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted-foreground)]"
        >
          {it.kind === 'project' ? <Folder className="h-3 w-3" /> : <Tag className="h-3 w-3" />}
          {it.name}
        </span>
      ))}
      <button
        type="button"
        onClick={() => onAccept(d.id)}
        disabled={busy}
        className="rounded-full disabled:opacity-50 bg-[var(--color-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-border)]"
        aria-label={`Accept suggestion for ${d.line}`}
      >
        Accept
      </button>
    </div>
  );
}

/** Read-only preview of what a draft line will set, so the user can check before adding. */
function DraftChips({
  line,
  included,
  projects,
  fallbackProjectId,
}: {
  line: string;
  included: boolean;
  projects: Project[];
  fallbackProjectId: string;
}) {
  const { formatDate, formatDateTime } = useDateFormatter();
  // The same Quick Add Magic mode the prompt and the save use (see useRamble).
  const mode = useSettings((s) => s.quickAddMagicMode);
  const p = useMemo(() => parseQuickAdd(line, new Date(), mode), [line, mode]);
  const chips: Array<{ key: string; icon: ReactNode; text: string; warn?: boolean }> = [];
  // Token-only lines ("+Home tomorrow") have no title and are skipped on save.
  if (included && line.trim() && !hasTitle(line, mode))
    chips.push({ key: 'skip', icon: <X className="h-3 w-3" />, text: 'No title, will be skipped', warn: true });
  if (p.dueDate)
    chips.push({
      key: 'due',
      icon: <Calendar className="h-3 w-3" />,
      text: hasTimeOfDay(p.dueDate) ? formatDateTime(p.dueDate) : formatDate(p.dueDate),
    });
  if (p.repeatAfter !== null || p.repeatMode !== null)
    chips.push({ key: 'repeat', icon: <Repeat className="h-3 w-3" />, text: 'Repeats' });
  if (p.projectTitle) {
    const pv = projectPreview(projects, p.projectTitle, fallbackProjectId);
    chips.push({
      key: 'project',
      icon: <Folder className="h-3 w-3" />,
      text: pv.text,
      warn: pv.unresolved,
    });
  }
  for (const l of p.labelTitles) chips.push({ key: `l-${l}`, icon: <Tag className="h-3 w-3" />, text: l });
  if (p.priority) chips.push({ key: 'prio', icon: <Flag className="h-3 w-3" />, text: `P${p.priority}` });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 px-2 pb-1">
      {chips.map((c) => (
        <span
          key={c.key}
          className={cn(
            'inline-flex items-center gap-1 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[11px] text-[var(--color-muted-foreground)]',
            c.warn && 'text-[var(--color-destructive)]',
          )}
        >
          {c.icon}
          {c.text}
        </span>
      ))}
    </div>
  );
}
