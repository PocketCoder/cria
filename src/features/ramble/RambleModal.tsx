import { useEffect, useMemo, useRef, useState } from 'react';
import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import { Mic, Loader2, X, Plus, Trash2, Sparkles, ArrowLeft, Calendar, Repeat, Tag, Flag, Folder } from 'lucide-react';
import { generate } from '@/tauri/ai';
import { aiErrorMessage, parseLines, rambleInstructions, clip } from '@/lib/aiPrompts';
import { parseQuickAdd } from '@/lib/quickAddParser';
import { hasTimeOfDay, useDateFormatter } from '@/lib/dateFormat';
import { isMobilePlatform } from '@/lib/platform';
import { useIsMobile } from '@/lib/useIsMobile';
import { useSelectableProjects } from '@/queries/projects';
import { useLabels } from '@/queries/labels';
import { useUi } from '@/stores/ui';
import { cn } from '@/lib/cn';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { createFromQuickAdd } from './createFromQuickAdd';

type Phase = 'input' | 'thinking' | 'review' | 'saving';

interface Draft {
  id: number;
  line: string;
  include: boolean;
}

/**
 * Ramble: talk (or type) freely, get a reviewed batch of tasks.
 *
 * Speech comes from the OS's own dictation into the text box (no mic
 * permission or speech code of ours). The on-device model rewrites the ramble
 * as quick-add lines ("Call dentist next tue !3 +Health"), so the existing
 * quick-add parser resolves dates, projects and labels, and the user edits
 * those lines directly in review. The model call survives app switching
 * (iOS Live Activity / desktop notification, see src/tauri/ai.ts).
 */
export function RambleModal({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const { data: projects = [] } = useSelectableProjects();
  const { data: labels = [] } = useLabels();
  const activeView = useUi((s) => s.activeView);
  const text = useUi((s) => s.rambleDraft);
  const setText = useUi((s) => s.setRambleDraft);

  const [phase, setPhase] = useState<Phase>('input');
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const nextId = useRef(0);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Tasks with no (known) +project land here; defaults to the open project.
  const [projectId, setProjectId] = useState('');
  useEffect(() => {
    if (projectId || projects.length === 0) return;
    const open = activeView?.kind === 'project' ? activeView.localId : null;
    setProjectId(projects.find((p) => p.localId === open)?.localId ?? projects[0]!.localId);
  }, [projects, activeView, projectId]);

  useEffect(() => {
    textRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const organise = async () => {
    if (!text.trim() || phase === 'thinking') return;
    setPhase('thinking');
    setError(null);
    try {
      const out = await generate({
        title: 'Organising your ramble',
        instructions: rambleInstructions({
          projects: projects.map((p) => p.title),
          labels: labels.map((l) => l.title),
        }),
        prompt: clip(text.trim()),
      });
      const lines = parseLines(out);
      if (lines.length === 0) {
        setError("Couldn't find any tasks in that. Try saying what you need to do.");
        setPhase('input');
        return;
      }
      setDrafts(lines.map((line) => ({ id: nextId.current++, line, include: true })));
      setPhase('review');
    } catch (err) {
      setError(aiErrorMessage(err));
      setPhase('input');
    }
  };

  const chosen = drafts.filter((d) => d.include && d.line.trim());

  const addAll = async () => {
    if (chosen.length === 0 || !projectId) return;
    setPhase('saving');
    try {
      for (const d of chosen) {
        await createFromQuickAdd(d.line.trim(), { projects, fallbackProjectId: projectId });
      }
      setText('');
      onClose();
    } catch (err) {
      console.error('[ramble] task creation failed:', err);
      setError('Some tasks could not be created. Please try again.');
      setPhase('review');
    }
  };

  const updateDraft = (id: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const dictationHint = isMobilePlatform()
    ? 'Tap the microphone on the keyboard and talk.'
    : 'Press the dictation key (or fn twice) and talk.';

  const body = (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {phase === 'review' || phase === 'saving' ? (
            <button
              type="button"
              onClick={() => setPhase('input')}
              className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
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
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {(phase === 'input' || phase === 'thinking') && (
        <div className="space-y-3">
          <textarea
            aria-label="Everything on your mind"
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void organise();
              }
            }}
            disabled={phase === 'thinking'}
            rows={isMobile ? 6 : 8}
            placeholder="Everything on your mind: “call the dentist next week, renew car insurance before Friday, that’s important, and buy milk…”"
            className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm leading-relaxed placeholder-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] disabled:opacity-60"
          />
          {error ? (
            <p className="text-caption text-[var(--color-destructive)]">{error}</p>
          ) : (
            <p className="text-caption text-[var(--color-muted-foreground)]">{dictationHint}</p>
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
              disabled={!text.trim() || phase === 'thinking'}
              onClick={() => void organise()}
              className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              {phase === 'thinking' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {phase === 'thinking' ? 'Organising…' : 'Organise'}
            </button>
          </div>
        </div>
      )}

      {(phase === 'review' || phase === 'saving') && (
        <div className="space-y-3">
          <p className="text-caption text-[var(--color-muted-foreground)]">
            {chosen.length} task{chosen.length === 1 ? '' : 's'} selected. Edit any line; quick-add
            syntax works.
          </p>

          <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {drafts.map((d) => (
              <li key={d.id} className="group flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={d.include}
                  onChange={(e) => updateDraft(d.id, { include: e.target.checked })}
                  className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                  aria-label={`Include ${d.line}`}
                />
                <div className="min-w-0 flex-1">
                  <input
                    aria-label="Task"
                    type="text"
                    value={d.line}
                    onChange={(e) => updateDraft(d.id, { line: e.target.value })}
                    className={cn(
                      'w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-[var(--color-border)] focus:border-[var(--color-ring)] focus:outline-none',
                      !d.include && 'text-[var(--color-muted-foreground)] line-through',
                    )}
                  />
                  <DraftChips line={d.line} />
                </div>
                <button
                  type="button"
                  onClick={() => setDrafts((prev) => prev.filter((x) => x.id !== d.id))}
                  className="hover-reveal mt-1 shrink-0 rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
                  aria-label={`Remove ${d.line}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() =>
              setDrafts((prev) => [...prev, { id: nextId.current++, line: '', include: true }])
            }
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
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={phase === 'saving' || chosen.length === 0 || !projectId}
              onClick={() => void addAll()}
              className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              {phase === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {phase === 'saving'
                ? 'Adding…'
                : `Add ${chosen.length} task${chosen.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div
      className={cn(
        'fixed inset-0 z-50',
        isMobile ? '' : 'flex items-start justify-center bg-black/50 pt-24',
      )}
    >
      {isMobile ? (
        <>
          <BackdropDismiss onDismiss={onClose} className="sheet-backdrop" />
          <div className="absolute bottom-0 left-0 right-0 z-10 animate-[sheet-up_350ms_var(--spring-snappy)] rounded-t-2xl bg-[var(--color-card)] px-4 pb-8 pt-2 shadow-lg">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--color-muted-foreground)]/30" />
            {body}
          </div>
        </>
      ) : (
        <>
          <BackdropDismiss onDismiss={onClose} />
          <div className="relative bg-[var(--color-card)] border border-[var(--color-border)] w-11/12 max-w-lg rounded-lg p-4 shadow-lg">
            {body}
          </div>
        </>
      )}
    </div>
  );
}

/** Read-only preview of what a draft line will set, so the user can check before adding. */
function DraftChips({ line }: { line: string }) {
  const { formatDate, formatDateTime } = useDateFormatter();
  const p = useMemo(() => parseQuickAdd(line), [line]);
  const chips: Array<{ key: string; icon: React.ReactNode; text: string }> = [];
  if (p.dueDate)
    chips.push({
      key: 'due',
      icon: <Calendar className="h-3 w-3" />,
      text: hasTimeOfDay(p.dueDate) ? formatDateTime(p.dueDate) : formatDate(p.dueDate),
    });
  if (p.repeatAfter !== null || p.repeatMode !== null)
    chips.push({ key: 'repeat', icon: <Repeat className="h-3 w-3" />, text: 'Repeats' });
  if (p.projectTitle) chips.push({ key: 'project', icon: <Folder className="h-3 w-3" />, text: p.projectTitle });
  for (const l of p.labelTitles) chips.push({ key: `l-${l}`, icon: <Tag className="h-3 w-3" />, text: l });
  if (p.priority) chips.push({ key: 'prio', icon: <Flag className="h-3 w-3" />, text: `P${p.priority}` });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 px-2 pb-1">
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[11px] text-[var(--color-muted-foreground)]"
        >
          {c.icon}
          {c.text}
        </span>
      ))}
    </div>
  );
}
