import { useEffect, useMemo, useRef, useState } from 'react';
import { BackdropDismiss } from '@/components/ui/backdrop-dismiss';
import { Camera, X } from 'lucide-react';
import { useSelectableProjects } from '@/queries/projects';
import { useSettings } from '@/stores/settings';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';
import { extractListItems, type OcrEngine } from './ocr';
import { generate } from '@/tauri/ai';
import { aiErrorMessage, clip, parseLines, TIDY_LIST_INSTRUCTIONS } from '@/lib/aiPrompts';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { partialSaveMessage } from '@/lib/partialSave';
import { createTasksFromItems, selectedItems, withoutSaved, type DraftItem } from './photoItems';
import { PhotoExtracting, PhotoPrompt, PhotoReview } from './PhotoReview';

type Phase = 'idle' | 'extracting' | 'review' | 'saving' | 'error';

/**
 * Photograph a shopping list → one task per line item.
 *
 * Flow: pick/capture a photo → OCR (Apple Vision, Tesseract fallback) → review
 * & edit the detected items → create a task each, into the project chosen here
 * (seeded from settings) and optionally tagged with a label. Controlled modal:
 * opened from the mobile tab bar and the desktop toolbar via `ui.photoCaptureOpen`.
 */
export function PhotoTaskCreator({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const { data: projects = [] } = useSelectableProjects();
  const shoppingProjectId = useSettings((s) => s.shoppingProjectId);
  const shoppingLabel = useSettings((s) => s.shoppingLabel);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const autoPicked = useRef(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<OcrEngine | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);

  // Per-batch target, seeded from settings. A task always needs a home
  // project; the label is optional and created on first use.
  const defaultProjectId = useMemo(
    () => shoppingProjectId ?? projects[0]?.localId ?? '',
    [shoppingProjectId, projects],
  );
  const [projectId, setProjectId] = useState('');
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!projectId && defaultProjectId) setProjectId(defaultProjectId);
  }, [defaultProjectId, projectId]);

  useEffect(() => {
    setLabel(shoppingLabel);
  }, [shoppingLabel]);

  // Auto-open the photo picker once when the modal mounts — the whole point
  // of this entry is to grab a photo, so don't make the user click twice.
  useEffect(() => {
    if (!autoPicked.current) {
      autoPicked.current = true;
      fileInputRef.current?.click();
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip Escapes an inner picker already handled (defaultPrevented).
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const runOcr = async (file: File) => {
    setPhase('extracting');
    setError(null);
    try {
      const result = await extractListItems(file);
      setEngine(result.engine);
      if (result.items.length === 0) {
        setError("Couldn't find any list items in that photo. Try a clearer, well-lit shot.");
        setPhase('error');
        return;
      }
      setItems(
        result.items.map((text) => ({ id: nextId.current++, text, include: true })),
      );
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read the photo.');
      setPhase('error');
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (file) void runOcr(file);
    else if (phase === 'idle') onClose(); // cancelled the initial picker
  };

  const includedCount = selectedItems(items).length;

  // On-device model clean-up of the OCR'd lines (typos, split items, prices).
  // Replaces the list; the user still reviews before anything is created. The
  // list is locked while it runs (the result would overwrite edits), a result
  // that lands after the modal closed is dropped, and the pre-tidy list is kept
  // for one "Undo tidy" since the model may drop lines (or clip long input).
  const aiAvailable = useAiAvailable();
  const [tidying, setTidying] = useState(false);
  const [undoItems, setUndoItems] = useState<DraftItem[] | null>(null);
  const tidyRun = useRef(0);
  useEffect(
    () => () => {
      tidyRun.current++;
    },
    [],
  );
  const tidy = async () => {
    const before = items;
    const lines = items.filter((i) => i.include && i.text.trim()).map((i) => i.text.trim());
    if (lines.length === 0) return;
    const run = ++tidyRun.current;
    setTidying(true);
    setError(null);
    try {
      const out = await generate({
        title: 'Tidying your list',
        instructions: TIDY_LIST_INSTRUCTIONS,
        prompt: clip(lines.join('\n')),
      });
      if (run !== tidyRun.current) return;
      const cleaned = parseLines(out, 100);
      if (cleaned.length > 0) {
        setItems(cleaned.map((text) => ({ id: nextId.current++, text, include: true })));
        setUndoItems(before);
      }
    } catch (err) {
      if (run === tidyRun.current) setError(aiErrorMessage(err));
    } finally {
      if (run === tidyRun.current) setTidying(false);
    }
  };

  const undoTidy = () => {
    if (undoItems) setItems(undoItems);
    setUndoItems(null);
  };

  const handleCreate = async () => {
    const chosen = selectedItems(items);
    if (tidying || chosen.length === 0 || !projectId) return;
    setUndoItems(null); // a pre-tidy list would resurrect items saved below
    setPhase('saving');
    const savedIds = new Set<number>();
    try {
      await createTasksFromItems(chosen, projectId, label, (item) => savedIds.add(item.id));
      onClose();
    } catch (err) {
      console.error('[shopping-photo] task creation failed:', err);
      // Tasks already created must not come back on retry as duplicates.
      setItems((prev) => withoutSaved(prev, savedIds));
      setError(partialSaveMessage(savedIds.size, chosen.length));
      // Stay on the review step (the error shows inline) so the edited items
      // survive and Add can be pressed again; 'error' is for OCR failures.
      setPhase('review');
    }
  };

  const hiddenInput = (
    // No `capture` attribute: forcing the rear camera crashes the iOS
    // Simulator (no camera) and skips the photo library. Plain accept lets
    // iOS offer Photo Library / Take Photo / Files, and macOS/desktop open a
    // normal file dialog. The camera path still needs NSCameraUsageDescription
    // (see src-tauri/Info.ios.plist).
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={onFileChange}
    />
  );

  const body = (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Camera className="h-4 w-4" />
          Add from Photo
        </h2>
        <button
          onClick={onClose}
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {phase === 'extracting' && <PhotoExtracting />}

      {phase === 'idle' && (
        <PhotoPrompt
          message="Choose a photo of your shopping list."
          buttonLabel="Choose photo"
          className="flex flex-col items-center gap-3 py-10"
          messageClassName="text-sm text-[var(--color-muted-foreground)]"
          onPick={() => fileInputRef.current?.click()}
        />
      )}

      {phase === 'error' && (
        <PhotoPrompt
          message={error}
          buttonLabel="Try another photo"
          className="flex flex-col items-center gap-3 py-8 text-center"
          messageClassName="text-sm text-[var(--color-foreground)]"
          onPick={() => fileInputRef.current?.click()}
        />
      )}

      {(phase === 'review' || phase === 'saving') && (
        <PhotoReview
          items={items}
          setItems={setItems}
          includedCount={includedCount}
          engine={engine}
          error={error}
          aiAvailable={aiAvailable}
          tidying={tidying}
          onTidy={() => void tidy()}
          canUndoTidy={undoItems !== null}
          onUndoTidy={undoTidy}
          saving={phase === 'saving'}
          projects={projects}
          projectId={projectId}
          setProjectId={setProjectId}
          label={label}
          setLabel={setLabel}
          onAddItem={() => {
            const id = nextId.current++;
            setItems((prev) => [...prev, { id, text: '', include: true }]);
          }}
          onCancel={onClose}
          onCreate={handleCreate}
        />
      )}
    </>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add from Photo"
      className={cn(
        'fixed inset-0 z-50',
        isMobile ? '' : 'flex items-start justify-center bg-[var(--dialog-backdrop)] pt-24',
      )}
    >
      {hiddenInput}
      {isMobile ? (
        <>
          <BackdropDismiss onDismiss={onClose} className="sheet-backdrop" />
          <div className="absolute bottom-0 left-0 right-0 z-10 animate-[sheet-up_350ms_var(--spring-snappy)] rounded-t-2xl bg-[var(--sheet-bg)] px-4 pb-8 pt-2 shadow-[var(--shadow-sheet)] dark:border-t dark:border-[var(--sheet-border)]">
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
