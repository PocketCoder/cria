import { useEffect, useRef, useState } from 'react';
import { generate } from '@/tauri/ai';
import { aiErrorMessage, parseLines, rambleInstructions, clip } from '@/lib/aiPrompts';
import { useSelectableProjects } from '@/queries/projects';
import { useLabels } from '@/queries/labels';
import { useUi } from '@/stores/ui';
import { partialSaveMessage } from '@/lib/partialSave';
import { createFromQuickAdd } from './createFromQuickAdd';
import {
  appendBlankDraft,
  chosenDrafts,
  createDrafts,
  defaultProjectId,
  draftsFromLines,
  patchDraft,
  removeDraft,
  withoutSaved,
  type Draft,
  type Phase,
} from './rambleLogic';

/** State and actions for the Ramble flow: input, on-device organise, review, save. */
export function useRamble(onClose: () => void) {
  const { data: projects = [] } = useSelectableProjects();
  const { data: labels = [] } = useLabels();
  const activeView = useUi((s) => s.activeView);
  const text = useUi((s) => s.rambleDraft);
  const setText = useUi((s) => s.setRambleDraft);
  const pendingLines = useUi((s) => s.rambleLines);
  const setPendingLines = useUi((s) => s.setRambleLines);

  const [phase, setPhase] = useState<Phase>('input');
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const nextId = useRef(0);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // False once the sheet is closed; the model call can't be cancelled, so it
  // may still resolve afterwards.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Tasks with no (known) +project land here; defaults to the open project.
  const [projectId, setProjectId] = useState('');
  useEffect(() => {
    if (projectId) return;
    const next = defaultProjectId(projects, activeView);
    if (next) setProjectId(next);
  }, [projects, activeView, projectId]);

  useEffect(() => {
    textRef.current?.focus({ preventScroll: true });
  }, []);

  // Lines organised while the sheet was closed: review them on reopen.
  useEffect(() => {
    if (!pendingLines || phase !== 'input') return;
    setDrafts(draftsFromLines(pendingLines, nextId.current));
    nextId.current += pendingLines.length;
    setPendingLines(null);
    setError(null);
    setPhase('review');
  }, [pendingLines, phase, setPendingLines]);

  const organise = async () => {
    // Only from the input step: not mid-organise, and not mid-save (the save
    // loop is still creating the old drafts).
    if (!text.trim() || phase !== 'input') return;
    setPendingLines(null);
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
      if (!alive.current) {
        // Closed while organising: keep the result for the next open.
        if (lines.length > 0) setPendingLines(lines);
        return;
      }
      if (lines.length === 0) {
        setError("Couldn't find any tasks in that. Try saying what you need to do.");
        setPhase('input');
        return;
      }
      setDrafts(draftsFromLines(lines, nextId.current));
      nextId.current += lines.length;
      setPhase('review');
    } catch (err) {
      if (!alive.current) return;
      setError(aiErrorMessage(err));
      setPhase('input');
    }
  };

  const chosen = chosenDrafts(drafts);

  const addAll = async () => {
    if (chosen.length === 0 || !projectId) return;
    setPhase('saving');
    const savedIds = new Set<number>();
    try {
      await createDrafts(
        chosen,
        (d) => createFromQuickAdd(d.line.trim(), { projects, fallbackProjectId: projectId }),
        (d) => savedIds.add(d.id),
      );
      setText('');
      setPendingLines(null);
      onClose();
    } catch (err) {
      console.error('[ramble] task creation failed:', err);
      // Tasks already created must not come back on retry as duplicates.
      setDrafts((prev) => withoutSaved(prev, savedIds));
      setError(partialSaveMessage(savedIds.size, chosen.length));
      setPhase('review');
    }
  };

  const updateDraft = (id: number, patch: Partial<Draft>) =>
    setDrafts((prev) => patchDraft(prev, id, patch));
  const deleteDraft = (id: number) => setDrafts((prev) => removeDraft(prev, id));
  const addBlankDraft = () => {
    // Allocate the id here, not in the updater: updaters must stay pure.
    const id = nextId.current++;
    setDrafts((prev) => appendBlankDraft(prev, id));
  };

  return {
    text,
    setText,
    textRef,
    phase,
    setPhase,
    error,
    drafts,
    chosen,
    projects,
    projectId,
    setProjectId,
    organise,
    addAll,
    updateDraft,
    deleteDraft,
    addBlankDraft,
  };
}
