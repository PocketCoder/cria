import { useEffect, useMemo, useState } from 'react';
import { createTask } from '@/db/tasks';
import { applyLabelsByTitle } from '@/db/labels';
import { useUi } from '@/stores/ui';
import { useProjects } from '@/queries/projects';
import { parseQuickAdd } from '@/lib/quickAddParser';
import { QuickAddPreview } from '@/features/tasks/QuickAddPreview';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';
import { X } from 'lucide-react';
import type { TaskInput } from '@/domain/task';

export function QuickAddModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const activeView = useUi((s) => s.activeView);
  const selectedProjectId =
    activeView?.kind === 'project' ? activeView.localId : null;
  const { data: projects = [] } = useProjects();
  const [projectId, setProjectId] = useState<string | null>(
    selectedProjectId ?? null,
  );
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!projectId && selectedProjectId) setProjectId(selectedProjectId);
  }, [selectedProjectId, projectId]);

  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0]!.localId);
    }
  }, [projects, projectId]);

  // Resolve #project token — match case-insensitive against project titles
  const parsed = useMemo(() => parseQuickAdd(text), [text]);

  useEffect(() => {
    if (parsed.projectTitle && projects.length > 0) {
      const match = projects.find(
        (p) => p.title.toLowerCase() === parsed.projectTitle!.toLowerCase(),
      );
      if (match) setProjectId(match.localId);
    }
  }, [parsed.projectTitle, projects]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || submitting) return;
    if (!parsed.title) return;

    setSubmitting(true);
    try {
      // Resolve +project at submit time too — not only via the
      // dropdown-syncing effect — so a type-then-Enter race can't route
      // the task to the wrong (previously-selected) project.
      const matchedProject = parsed.projectTitle
        ? projects.find(
            (p) => p.title.toLowerCase() === parsed.projectTitle!.toLowerCase(),
          )
        : undefined;
      const input: TaskInput = {
        title: parsed.title,
        projectLocalId: matchedProject?.localId ?? projectId,
        ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
        ...(parsed.priority !== null ? { priority: parsed.priority } : {}),
        ...(parsed.repeatAfter !== null ? { repeatAfter: parsed.repeatAfter } : {}),
        ...(parsed.repeatMode !== null ? { repeatMode: parsed.repeatMode } : {}),
      };
      const created = await createTask(input);

      // Apply @label tokens — auto-create labels that don't exist yet
      if (parsed.labelTitles.length > 0 && created.localId) {
        try {
          await applyLabelsByTitle(created.localId, parsed.labelTitles);
        } catch (err) {
          console.warn('[quick-add] label application failed:', err);
        }
      }

      // +assignee tokens are not yet applied (no local users table)
      if (parsed.assigneeUsernames.length > 0) {
        console.info(
          '[quick-add] +assignee tokens are parsed but not yet applied:',
          parsed.assigneeUsernames,
        );
      }

      onClose();
    } catch (err) {
      console.error('Quick add failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        'fixed inset-0 z-50',
        isMobile ? '' : 'flex items-start justify-center bg-black/50 pt-24',
      )}
      onClick={isMobile ? undefined : onClose}
    >
      {isMobile && (
        <>
          <div className="sheet-backdrop absolute inset-0" onClick={onClose} />
          <div
            className="absolute bottom-0 left-0 right-0 z-10 animate-[sheet-up_350ms_var(--spring-snappy)] rounded-t-2xl bg-[var(--color-card)] px-4 pb-8 pt-2 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--color-muted-foreground)]/30" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Quick Add</h2>
              <button
                onClick={onClose}
                className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-2">
              <input
                type="text"
                placeholder="Buy milk tomorrow *groceries !2 @alice +Personal"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2.5 text-base placeholder-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
              <QuickAddPreview parsed={parsed} />
              <div className="flex items-center justify-between gap-2">
                <select
                  value={projectId ?? ''}
                  onChange={(e) => setProjectId(e.target.value || null)}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-sm"
                  aria-label="Project"
                >
                  {projects.length === 0 ? (
                    <option value="">No projects</option>
                  ) : (
                    projects.map((p) => (
                      <option key={p.localId} value={p.localId}>
                        {p.title}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="submit"
                  disabled={submitting || !parsed.title || !projectId}
                  className="rounded-md bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? 'Adding…' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
      {!isMobile && (
        <div
          className="glass-surface w-11/12 max-w-lg rounded-lg p-4 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Quick Add</h2>
            <button
              onClick={onClose}
              className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-2">
            <input
              type="text"
              placeholder="Buy milk tomorrow *groceries !2 @alice +Personal"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm placeholder-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
            <QuickAddPreview parsed={parsed} />
            <div className="flex items-center justify-between gap-2">
              <select
                value={projectId ?? ''}
                onChange={(e) => setProjectId(e.target.value || null)}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-xs"
                aria-label="Project"
              >
                {projects.length === 0 ? (
                  <option value="">No projects</option>
                ) : (
                  projects.map((p) => (
                    <option key={p.localId} value={p.localId}>
                      {p.title}
                    </option>
                  ))
                )}
              </select>
              <div className="flex items-center gap-2 text-[11px] text-[var(--color-muted-foreground)]">
                <span>Enter to add · Esc to cancel</span>
                <button
                  type="submit"
                  disabled={submitting || !parsed.title || !projectId}
                  className="rounded-md bg-[var(--color-primary)] px-3 py-1 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
