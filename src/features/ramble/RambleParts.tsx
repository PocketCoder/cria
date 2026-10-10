import { useMemo, type ReactNode, type RefObject } from 'react';
import {
  Mic,
  Square,
  Check,
  Loader2,
  X,
  Plus,
  Trash2,
  Sparkles,
  ArrowLeft,
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

export function RambleHeader({
  reviewing,
  busy,
  onBack,
  onClose,
}: {
  reviewing: boolean;
  /**
   * Saving: Back and Close are inert. Back would let Organise replace drafts
   * mid-save; closing would let the save finish against a reopened sheet.
   */
  busy: boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {reviewing ? (
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-50 disabled:hover:text-[var(--color-muted-foreground)]"
            aria-label="Back to ramble"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <Mic className="h-4 w-4" />
        )}
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

/** Mic toggle: tap and talk, tap again to stop. Pulses while listening. */
export function MicButton({
  listening,
  disabled,
  onToggle,
  size = 'md',
}: {
  listening: boolean;
  disabled?: boolean;
  onToggle: () => void;
  size?: 'md' | 'lg';
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? 'Stop listening' : 'Start talking'}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50',
        size === 'lg' ? 'h-14 w-14' : 'h-9 w-9',
        listening
          ? 'animate-pulse bg-[var(--color-destructive)] text-white'
          : 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90',
      )}
    >
      {listening ? <Square className="h-4 w-4 fill-current" /> : <Mic className={size === 'lg' ? 'h-6 w-6' : 'h-4 w-4'} />}
    </button>
  );
}

/** Free-text box plus the Organise button. */
export function RambleInput({
  text,
  setText,
  textRef,
  thinking,
  error,
  hint,
  rows,
  onOrganise,
  onMic,
}: {
  text: string;
  setText: (v: string) => void;
  textRef: RefObject<HTMLTextAreaElement>;
  thinking: boolean;
  error: string | null;
  hint: string;
  rows: number;
  onOrganise: () => void;
  onMic: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center gap-1 py-1">
        <MicButton listening={false} disabled={thinking} onToggle={onMic} size="lg" />
        <span className="text-caption text-[var(--color-muted-foreground)]">Tap and start talking</span>
      </div>
      <textarea
        aria-label="Everything on your mind"
        ref={textRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onOrganise();
          }
        }}
        disabled={thinking}
        rows={rows}
        placeholder="Everything on your mind: “call the dentist next week, renew car insurance before Friday, that’s important, and buy milk…”"
        className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm leading-relaxed placeholder-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] disabled:opacity-60"
      />
      {error ? (
        <p className="text-caption text-[var(--color-destructive)]">{error}</p>
      ) : (
        <p className="text-caption text-[var(--color-muted-foreground)]">{hint}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span
          className="flex items-center gap-1 text-caption text-[var(--color-muted-foreground)]"
          title="Processed on-device with Apple Intelligence"
        >
          <Sparkles className="h-3 w-3" /> On-device
        </span>
        <button
          type="button"
          disabled={!text.trim() || thinking}
          onClick={onOrganise}
          className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {thinking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {thinking ? 'Organising…' : 'Organise'}
        </button>
      </div>
    </div>
  );
}

/** Editable list of drafted tasks, default project and the Add button. */
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
  onAddBlank,
  onCancel,
  onAddAll,
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
  onAddBlank: () => void;
  onCancel: () => void;
  onAddAll: () => void;
}) {
  const saving = phase === 'saving';
  const magicOff = useSettings((s) => s.quickAddMagicMode === 'disabled');
  const suggestionCount = drafts.filter((d) => hasUsableSuggestion(d, suggestionCtx)).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <MicButton listening={listening} disabled={saving} onToggle={onMic} />
        <div className="min-w-0 flex-1 text-caption text-[var(--color-muted-foreground)]" aria-live="polite">
          {interim ? (
            <span className="italic">{interim}</span>
          ) : listening ? (
            'Listening… say what you need to do.'
          ) : drafts.length === 0 ? (
            'Tap the mic and start talking.'
          ) : (
            `${chosenCount} task${chosenCount === 1 ? '' : 's'} ready. Edit any line${magicOff ? '.' : '; quick-add syntax works.'}`
          )}
        </div>
        {organising && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-muted-foreground)]" />}
      </div>

      {suggestionCount > 0 && (
        <button
          type="button"
          onClick={onAcceptAll}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-caption text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3" /> Accept all suggestions ({suggestionCount})
        </button>
      )}

      <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
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
      </ul>

      <button
        type="button"
        onClick={onAddBlank}
        className="flex items-center gap-1 text-caption text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <Plus className="h-3.5 w-3.5" /> Add task
      </button>

      <label className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3 text-caption">
        <span className="text-[var(--color-muted-foreground)]">Project for the rest</span>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger
            className="w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-sm"
            aria-label="Default project"
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
      </label>

      {error && <p className="text-caption text-[var(--color-destructive)]">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || chosenCount === 0 || !projectId}
          onClick={onAddAll}
          className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? 'Adding…' : `Add all (${chosenCount})`}
        </button>
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
  return (
    <li className="group flex items-start gap-2">
      <input
        type="checkbox"
        checked={d.include}
        onChange={(e) => onUpdate(d.id, { include: e.target.checked })}
        className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
        aria-label={`Include ${d.line}`}
      />
      <div className="min-w-0 flex-1">
        <input
          aria-label="Task"
          type="text"
          value={d.line}
          onChange={(e) => onUpdate(d.id, { line: e.target.value })}
          className={cn(
            'w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-[var(--color-border)] focus:border-[var(--color-ring)] focus:outline-none',
            !d.include && 'text-[var(--color-muted-foreground)] line-through',
          )}
        />
        <DraftChips
          line={d.line}
          included={d.include}
          projects={projects}
          fallbackProjectId={fallbackProjectId}
        />
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
        className="hover-reveal mt-1 shrink-0 rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
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
  const names = [...(u.project ? [u.project] : []), ...u.labels];
  if (names.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 px-2 pb-1">
      <Sparkles className="h-3 w-3 text-[var(--color-muted-foreground)]" aria-hidden />
      {names.map((n) => (
        <span
          key={n}
          className="rounded-full border border-dashed border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted-foreground)]"
        >
          {n}
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
