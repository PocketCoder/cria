import { lazy, Suspense } from 'react';
import type { RichTextEditorProps } from './RichTextEditorImpl';

// Re-export the props type so existing imports of it keep resolving
// against `./RichTextEditor`.
export type { RichTextEditorProps };

// Lazy-load the real editor so the ~600 KB of ProseMirror / TipTap code
// it pulls in stays out of the startup bundle — it's only fetched the
// first time a description or comment editor actually renders.
const RichTextEditorImpl = lazy(() =>
  import('./RichTextEditorImpl').then((m) => ({ default: m.RichTextEditorImpl })),
);

/**
 * Thin lazy wrapper around the TipTap editor. Has the same props and the
 * same named export as the original component, so both call sites
 * (TaskDetail.tsx, CommentSection.tsx) keep importing `{ RichTextEditor }`
 * unchanged. The Suspense fallback is a small placeholder roughly matching
 * the editor container's footprint while the chunk loads.
 */
export function RichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-[6rem] rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-2 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
          Loading editor…
        </div>
      }
    >
      <RichTextEditorImpl {...props} />
    </Suspense>
  );
}
