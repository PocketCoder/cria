import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Loader2, X, Plus, Trash2, Sparkles } from 'lucide-react';
import { createTask } from '@/db/tasks';
import { applyLabelsByTitle } from '@/db/labels';
import { useProjects } from '@/queries/projects';
import { useSettings } from '@/stores/settings';
import { useIsMobile } from '@/lib/useIsMobile';
import { cn } from '@/lib/cn';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { extractListItems, type OcrEngine } from './ocr';

type Phase = 'idle' | 'extracting' | 'review' | 'saving' | 'error';

interface DraftItem {
  id: number;
  text: string;
  include: boolean;
}

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
  const { data: projects = [] } = useProjects();
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
      if (e.key === 'Escape') {
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

  const includedCount = items.filter((i) => i.include && i.text.trim()).length;

  const handleCreate = async () => {
    const chosen = items.filter((i) => i.include && i.text.trim());
    if (chosen.length === 0 || !projectId) return;
    setPhase('saving');
    const tag = label.trim();
    try {
      for (const item of chosen) {
        const task = await createTask({ title: item.text.trim(), projectLocalId: projectId });
        if (tag && task.localId) {
          try {
            await applyLabelsByTitle(task.localId, [tag]);
          } catch (err) {
            console.warn('[shopping-photo] label apply failed:', err);
          }
        }
      }
      onClose();
    } catch (err) {
      console.error('[shopping-photo] task creation failed:', err);
      setError('Some tasks could not be created. Please try again.');
      setPhase('error');
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

      {phase === 'extracting' && (
        <div className="flex flex-col items-center gap-3 py-10 text-[var(--color-muted-foreground)]">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Reading your list…</p>
        </div>
      )}

      {phase === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Choose a photo of your shopping list.
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
          >
            <Camera className="h-4 w-4" /> Choose photo
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-[var(--color-foreground)]">{error}</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
          >
            <Camera className="h-4 w-4" /> Try another photo
          </button>
        </div>
      )}

      {(phase === 'review' || phase === 'saving') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-caption text-[var(--color-muted-foreground)]">
            <span>
              {includedCount} item{includedCount === 1 ? '' : 's'} selected
            </span>
            {engine === 'vision' && (
              <span className="flex items-center gap-1" title="Read on-device with Apple Vision">
                <Sparkles className="h-3 w-3" /> On-device
              </span>
            )}
          </div>

          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {items.map((item) => (
              <li key={item.id} className="group flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.include}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((i) =>
                        i.id === item.id ? { ...i, include: e.target.checked } : i,
                      ),
                    )
                  }
                  className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                  aria-label={`Include ${item.text}`}
                />
                <input
                  type="text"
                  value={item.text}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((i) =>
                        i.id === item.id ? { ...i, text: e.target.value } : i,
                      ),
                    )
                  }
                  className={cn(
                    'flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-[var(--color-border)] focus:border-[var(--color-ring)] focus:outline-none',
                    !item.include && 'text-[var(--color-muted-foreground)] line-through',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                  className="hover-reveal shrink-0 rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
                  aria-label={`Remove ${item.text}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() =>
              setItems((prev) => [...prev, { id: nextId.current++, text: '', include: true }])
            }
            className="flex items-center gap-1 text-caption text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            <Plus className="h-3.5 w-3.5" /> Add item
          </button>

          <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
            <label className="flex items-center justify-between gap-2 text-caption">
              <span className="text-[var(--color-muted-foreground)]">Project</span>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger
                  className="w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-sm"
                  aria-label="Project"
                >
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.localId} value={p.localId}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--color-border)]"
                          style={p.hexColor ? { backgroundColor: p.hexColor } : undefined}
                        />
                        {p.title}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center justify-between gap-2 text-caption">
              <span className="text-[var(--color-muted-foreground)]">Label (optional)</span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. shopping"
                className="w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-sm placeholder-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
              />
            </label>
          </div>

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
              disabled={phase === 'saving' || includedCount === 0 || !projectId}
              onClick={handleCreate}
              className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-[var(--color-primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              {phase === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {phase === 'saving'
                ? 'Adding…'
                : `Add ${includedCount} task${includedCount === 1 ? '' : 's'}`}
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
      onClick={isMobile ? undefined : onClose}
    >
      {hiddenInput}
      {isMobile ? (
        <>
          <div className="sheet-backdrop absolute inset-0" onClick={onClose} />
          <div
            className="absolute bottom-0 left-0 right-0 z-10 animate-[sheet-up_350ms_var(--spring-snappy)] rounded-t-2xl bg-[var(--color-card)] px-4 pb-8 pt-2 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--color-muted-foreground)]/30" />
            {body}
          </div>
        </>
      ) : (
        <div
          className="glass-surface w-11/12 max-w-lg rounded-lg p-4 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {body}
        </div>
      )}
    </div>
  );
}
