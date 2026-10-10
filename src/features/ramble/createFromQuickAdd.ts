import { parseQuickAdd } from '@/lib/quickAddParser';
import type { QuickAddMagicMode } from '@/lib/quickAddPrefixes';
import { createTask } from '@/db/tasks';
import { applyLabelsByTitle } from '@/db/labels';
import type { Project } from '@/domain/project';
import { findProjectByTitle, notesToHtml } from './rambleLogic';

/**
 * Create one task from a quick-add line ("Call dentist next tue +Health *calls !3").
 *
 * The batch counterpart of QuickAddModal's submit, minus its picker state:
 * an unknown or missing +project falls back to `fallbackProjectId` (the
 * project chosen in the sheet) rather than the Inbox, since a ramble is
 * filed in one go. @assignee tokens are ignored, as in quick-add. Parsed in
 * the user's Quick Add Magic `mode`, the syntax the model was asked to write
 * (see hasTitle).
 */
export async function createFromQuickAdd(
  line: string,
  ctx: { projects: Project[]; fallbackProjectId: string; mode: QuickAddMagicMode; notes?: string },
): Promise<void> {
  const parsed = parseQuickAdd(line, new Date(), ctx.mode);
  if (!parsed.title) return;
  const project = parsed.projectTitle ? findProjectByTitle(ctx.projects, parsed.projectTitle) : undefined;
  const task = await createTask({
    title: parsed.title,
    ...(ctx.notes ? { description: notesToHtml(ctx.notes) } : {}),
    projectLocalId: project?.localId ?? ctx.fallbackProjectId,
    ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
    ...(parsed.priority ? { priority: parsed.priority } : {}),
    ...(parsed.repeatAfter !== null ? { repeatAfter: parsed.repeatAfter } : {}),
    ...(parsed.repeatMode !== null ? { repeatMode: parsed.repeatMode } : {}),
  });
  if (parsed.labelTitles.length > 0) {
    try {
      await applyLabelsByTitle(task.localId, parsed.labelTitles);
    } catch (err) {
      console.warn('[ramble] label application failed:', err);
    }
  }
}
