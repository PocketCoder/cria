import { useEffect, useRef, useState } from 'react';
import { generate } from '@/tauri/ai';
import { speechErrorMessage, startSpeech, type SpeechSession } from '@/tauri/speech';
import { parseLines, rambleInstructions, clip } from '@/lib/aiPrompts';
import { useSelectableProjects } from '@/queries/projects';
import { useLabels } from '@/queries/labels';
import { useUi } from '@/stores/ui';
import { useSettings } from '@/stores/settings';
import { partialSaveMessage } from '@/lib/partialSave';
import { createFromQuickAdd } from './createFromQuickAdd';
import {
  acceptAllSuggestions,
  acceptSuggestion,
  chosenDrafts,
  createDrafts,
  defaultProjectId,
  draftToRaw,
  draftsFromLines,
  hasTitle,
  patchDraft,
  removeDraft,
  withoutSaved,
  type Draft,
  type Phase,
} from './rambleLogic';

/** State and actions for the Ramble flow: listen, organise on-device into rows, review, save. Voice only. */
export function useRamble(onClose: () => void) {
  const { data: projects = [] } = useSelectableProjects();
  const { data: labels = [] } = useLabels();
  const activeView = useUi((s) => s.activeView);
  const pendingLines = useUi((s) => s.rambleLines);
  const setPendingLines = useUi((s) => s.setRambleLines);
  // The model writes, and every parse reads, the user's Quick Add Magic syntax.
  const mode = useSettings((s) => s.quickAddMagicMode);
  // Latest values for the async mic flow, whose callbacks outlive the render
  // that started dictation (projects may still be loading then).
  const latest = useRef({ projects, labels, mode });
  latest.current = { projects, labels, mode };
  const suggestionCtx = { projects, labels, mode };

  const [phase, setPhase] = useState<Phase>('review');
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const nextId = useRef(0);
  // False once the sheet is closed; the model call can't be cancelled, so it
  // may still resolve afterwards.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      speech.current?.stop();
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, []);

  // Live mic: finished phrases are buffered, then organised in one batch so a
  // burst of speech costs one model call rather than one per phrase.
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [organising, setOrganising] = useState(false);
  const speech = useRef<SpeechSession | null>(null);
  const buffer = useRef<string[]>([]);
  const flushing = useRef(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Off after the first model failure (no Apple Intelligence, etc.): phrases
  // then become rows verbatim, and quick-add parsing still resolves dates.
  const aiOk = useRef(true);

  // Tasks with no (known) +project land here; defaults to the open project.
  const [projectId, setProjectId] = useState('');
  useEffect(() => {
    if (projectId) return;
    const next = defaultProjectId(projects, activeView);
    if (next) setProjectId(next);
  }, [projects, activeView, projectId]);

  // Rows organised while the sheet was closed: shown (never auto-added) on reopen.
  // Read and clear the store synchronously: StrictMode re-runs this effect with
  // the same `pendingLines`, which would otherwise add the rows twice.
  useEffect(() => {
    const lines = useUi.getState().rambleLines;
    if (!lines) return;
    setPendingLines(null);
    const first = nextId.current;
    nextId.current += lines.length;
    setDrafts((prev) => [...prev, ...draftsFromLines(lines, first, mode)]);
  }, [pendingLines, setPendingLines, mode]);

  const appendLines = (lines: string[]) => {
    if (lines.length === 0) return;
    if (!alive.current) {
      // Closed mid-batch: keep the rows for the next open.
      setPendingLines([...(useUi.getState().rambleLines ?? []), ...lines]);
      return;
    }
    const first = nextId.current;
    nextId.current += lines.length;
    setDrafts((prev) => [...prev, ...draftsFromLines(lines, first, latest.current.mode)]);
  };

  const flush = async () => {
    if (flushing.current) return;
    flushing.current = true;
    setOrganising(true);
    try {
      while (buffer.current.length > 0) {
        const chunk = buffer.current.splice(0).join('. ');
        let lines = [chunk];
        if (aiOk.current) {
          try {
            const { projects, labels, mode } = latest.current;
            lines = parseLines(
              await generate({
                title: 'Organising your ramble',
                instructions: rambleInstructions({
                  projects: projects.map((p) => p.title),
                  labels: labels.map((l) => l.title),
                  mode,
                }),
                prompt: clip(chunk),
              }),
            );
          } catch (err) {
            console.warn('[ramble] organise failed, keeping raw phrase:', err);
            aiOk.current = false;
          }
        }
        appendLines(lines);
      }
    } finally {
      flushing.current = false;
      if (alive.current) setOrganising(false);
    }
  };

  const scheduleFlush = (delay: number) => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => void flush(), delay);
  };

  const starting = useRef(false);
  // Pause tapped while the mic was still starting: stop it as soon as it is up.
  const stopRequested = useRef(false);
  const toggleMic = async () => {
    if (speech.current) {
      speech.current.stop();
      return;
    }
    if (starting.current) {
      stopRequested.current = true;
      return;
    }
    if (phase === 'saving') return;
    starting.current = true;
    stopRequested.current = false;
    setError(null);
    try {
      const session = await startSpeech({
        onInterim: (t) => alive.current && setInterim(t),
        onFinal: (t) => {
          buffer.current.push(t);
          setOrganising(true);
          scheduleFlush(600);
        },
        onEnd: (err) => {
          speech.current = null;
          if (flushTimer.current) clearTimeout(flushTimer.current);
          void flush();
          if (!alive.current) return;
          setListening(false);
          setInterim('');
          if (err) setError(speechErrorMessage(err));
        },
      });
      if (!alive.current || stopRequested.current) {
        session.stop();
        return;
      }
      speech.current = session;
      setListening(true);
    } catch (err) {
      console.warn('[ramble] dictation unavailable:', err);
      setError('Dictation is not available on this device.');
    } finally {
      starting.current = false;
    }
  };

  // Listen as soon as the sheet opens, like speaking to an assistant.
  useEffect(() => {
    void toggleMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  const chosen = chosenDrafts(drafts, mode);
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(new Set());

  // Closing is inert while saving: the save loop can't be cancelled and its
  // completion would close (or clear) a sheet the user has since reopened.
  const close = () => {
    if (phase !== 'saving') onClose();
  };

  const addAll = async () => {
    // Not while speech is still turning into rows: those tasks haven't been seen yet.
    // Nor while a row's own add is in flight: it would be created twice.
    if (chosen.length === 0 || !projectId || organising || interim || busyIds.size > 0) return;
    speech.current?.stop();
    setPhase('saving');
    const savedIds = new Set<number>();
    const remaining = drafts;
    try {
      await createDrafts(
        chosen,
        (d) => createFromQuickAdd(d.line.trim(), { projects, fallbackProjectId: projectId, mode, notes: d.notes }),
        (d) => savedIds.add(d.id),
      );
      if (!alive.current) {
        // Unmounted mid-save: the sheet is gone, and a reopened one is not ours to close.
        return;
      }
      setPendingLines(null);
      onClose();
    } catch (err) {
      console.error('[ramble] task creation failed:', err);
      if (!alive.current) {
        // Keep the unsaved lines for the next open, so a retry skips the saved ones.
        const left = withoutSaved(remaining, savedIds).map(draftToRaw);
        if (left.length > 0 && useUi.getState().rambleLines === null) setPendingLines(left);
        return;
      }
      // Tasks already created must not come back on retry as duplicates.
      setDrafts((prev) => withoutSaved(prev, savedIds));
      setError(partialSaveMessage(savedIds.size, chosen.length));
      setPhase('review');
    }
  };

  const updateDraft = (id: number, patch: Partial<Draft>) =>
    setDrafts((prev) => patchDraft(prev, id, patch));
  const acceptOne = (id: number) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? acceptSuggestion(d, suggestionCtx) : d)));
  const acceptAll = () => setDrafts((prev) => acceptAllSuggestions(prev, suggestionCtx));
  const deleteDraft = (id: number) => setDrafts((prev) => removeDraft(prev, id));

  const addOne = async (id: number) => {
    const d = drafts.find((x) => x.id === id);
    if (!d || !projectId || !hasTitle(d.line, mode) || busyIds.has(id) || phase === 'saving') return;
    setBusyIds((prev) => new Set(prev).add(id));
    setError(null);
    try {
      await createFromQuickAdd(d.line.trim(), { projects, fallbackProjectId: projectId, mode, notes: d.notes });
      if (alive.current) setDrafts((prev) => removeDraft(prev, id));
    } catch (err) {
      console.error('[ramble] task creation failed:', err);
      if (alive.current) setError("Couldn't add that task. Try again.");
    } finally {
      if (alive.current)
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
    }
  };

  return {
    acceptOne,
    acceptAll,
    suggestionCtx,
    listening,
    interim,
    organising,
    toggleMic,
    addOne,
    busyIds,
    phase,
    close,
    error,
    drafts,
    chosen,
    projects,
    projectId,
    setProjectId,
    addAll,
    updateDraft,
    deleteDraft,
  };
}
