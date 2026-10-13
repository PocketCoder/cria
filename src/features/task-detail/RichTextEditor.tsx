import { useEffect, useState, type ComponentType } from 'react';
import type { RichTextEditorProps } from './RichTextEditorImpl';

// Re-export the props type so existing imports of it keep resolving
// against `./RichTextEditor`.
export type { RichTextEditorProps };

// Load the real editor on demand so the ~600 KB of ProseMirror / TipTap code
// it pulls in stays out of the startup bundle — it's only fetched the first
// time a description or comment editor actually renders.
//
// Deliberately not `React.lazy` + `Suspense`: if the inspector re-rendered
// while the chunk was in flight, React 18 sometimes never retried the
// boundary and the panel stayed on "Loading editor…" for good (caught by the
// soak test, ~1 in 4 cold starts). A module-level promise plus state can't
// lose its wake-up.
let Impl: ComponentType<RichTextEditorProps> | null = null;
let loading: Promise<void> | null = null;

function loadImpl(): Promise<void> {
  loading ??= import('./RichTextEditorImpl').then(
    (m) => {
      Impl = m.RichTextEditorImpl;
    },
    (err) => {
      loading = null; // allow a retry on the next mount
      throw err;
    },
  );
  return loading;
}

/**
 * Thin on-demand wrapper around the TipTap editor. Has the same props and
 * the same named export as the original component, so both call sites
 * (TaskDetail.tsx, CommentSection.tsx) keep importing `{ RichTextEditor }`
 * unchanged. Shows a small placeholder roughly matching the editor
 * container's footprint while the chunk loads.
 */
export function RichTextEditor(props: RichTextEditorProps) {
  const [, setLoaded] = useState(Impl !== null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (Impl) return;
    let cancelled = false;
    loadImpl().then(
      () => !cancelled && setLoaded(true),
      (err) => {
        console.error('[RichTextEditor] failed to load editor:', err);
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (Impl) return <Impl {...props} />;
  return (
    <div className="min-h-[6rem] rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
      {failed ? 'Couldn’t load the editor. Close and reopen the task to retry.' : 'Loading editor…'}
    </div>
  );
}
