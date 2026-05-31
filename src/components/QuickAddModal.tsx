import { useEffect, useMemo, useState } from 'react';

import { createTask } from '@/db/tasks';
import { applyLabelsByTitle } from '@/db/labels';
import { useUi } from '@/stores/ui';
import { useProjects } from '@/queries/projects';
import { parseQuickAdd } from '@/lib/quickAddParser';
import { QuickAddPreview } from '@/features/tasks/QuickAddPreview';
import { X } from 'lucide-react';
import type { TaskInput } from '@/domain/task';

/**
 * Global quick-add modal (Cmd+Shift+A). Same natural-language parser as
 * the inline TaskList input. Adds a project picker because there's no
 * implicit project context when summoned via the global shortcut.
 *
 * Default project: the one currently selected in the sidebar; falling
 * back to the first available project. The user can change it inline
 * via the dropdown.
 */
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

  // Sync the picker with the sidebar selection if it changes while the
  // modal is open (unlikely but cheap).
  useEffect(() => {
    if (!projectId && selectedProjectId) setProjectId(selectedProjectId);
  }, [selectedProjectId, projectId]);

  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0]!.localId);
    }
  }, [projects, projectId]);

  // Close on Escape. Listening on `window` rather than the dialog root
  // means focus inside the <input> (which has its own keyboard handling)
  // still surfaces Escape — input-level keydown doesn't stop propagation
  // by default, but a stray library handler could; window-level is the
  // belt-and-braces option for a one-off modal.
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

  const parsed = useMemo(() => parseQuickAdd(text), [text]);

  // Resolve a +ProjectName token from the parser to a project local_id.
  // Matches case-insensitively against the project title. If found, it
  // takes priority over the sidebar-selected project.
  const projectFromToken = useMemo(() => {
    if (!parsed.projectTitle) return null;
    const lower = parsed.projectTitle.toLowerCase();
    return projects.find((p) => p.title.toLowerCase() === lower)?.localId ?? null;
  }, [parsed.projectTitle, projects]);

  // Apply +ProjectName token: when the resolved id differs from the
  // current picker value, switch to it.
  useEffect(() => {
    if (projectFromToken && projectFromToken !== projectId) {
      setProjectId(projectFromToken);
    }
  }, [projectFromToken, projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || submitting) return;
    if (!parsed.title) return;

    setSubmitting(true);
    try {
      const input: TaskInput = {
        title: parsed.title,
        projectLocalId: projectId,
        ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
        ...(parsed.priority !== null ? { priority: parsed.priority } : {}),
      };
      const created = await createTask(input);

      if (parsed.labelTitles.length > 0 && created.localId) {
        try {
          await applyLabelsByTitle(created.localId, parsed.labelTitles);
        } catch (err) {
          console.warn('[quick-add] label application failed:', err);
        }
      }
      if (parsed.assigneeUsernames.length > 0) {
        console.info(
          '[quick-add] @assignee tokens parsed but not yet applied:',
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24"
      onClick={onClose}
    >
      <div
        className="w-11/12 max-w-lg rounded-lg bg-[var(--color-background)] p-4 shadow-lg"
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
            placeholder="Buy milk tomorrow #shopping !2 @alice"
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
    </div>
  );
}
