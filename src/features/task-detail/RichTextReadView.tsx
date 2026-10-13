import { useEffect, useState, useRef } from 'react';
import { Pencil } from 'lucide-react';
import { inlineImageObjectUrl } from './inlineImageUrls';
import { inlineImageSource } from '@/sync/attachments';
import { ImageLightbox } from './ImageLightbox';
import { sanitizeHtml } from '@/lib/sanitize';
import { onLinkClickOpenExternal } from '@/lib/openExternal';
import { isEmptyDescription, setTaskItemChecked } from './editorLogic';

/**
 * Stored rich-text HTML (a description or a comment), sanitised and shown
 * read-only. Inline images go through the same authenticated path as the
 * editor: attachments on this server are auth-fetched, queued uploads load
 * from the local bytes, and clicking an attachment opens the lightbox. Links
 * open in the OS browser.
 *
 * Only the DOM is touched at runtime; nothing here writes the swapped image
 * sources back, so the stored markup round-trips as the server sent it.
 */
export function RichTextView({
  html,
  className,
  taskServerId,
  onSave,
}: {
  html: string;
  className: string;
  /** Re-resolves the images when the task gets its server id. */
  taskServerId: number | null;
  /** Persists a task-list checkbox toggle without entering edit mode.
   * Without it a toggle isn't saved. */
  onSave?: (html: string) => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<{
    taskServerId: number;
    attachmentServerId: number;
    fileName: string;
  } | null>(null);

  /**
   * Container click dispatch for rendered rich text.
   *
   * 1. **Task-list checkbox** → toggle in the stored HTML + save in place.
   *    There's no TipTap editor here (the text is just sanitised HTML
   *    through dangerouslySetInnerHTML), so we flip the Nth task item in
   *    the source string and call onSave directly.
   * 2. **Inline image** → open the lightbox (same `<img>` walk as
   *    before).
   * 3. **Anchor** → route through `onLinkClickOpenExternal` to open
   *    in the OS browser.
   */
  const onContainerClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;

    if (
      onSave &&
      target instanceof HTMLInputElement &&
      target.type === 'checkbox' &&
      target.closest('li[data-type="taskItem"]')
    ) {
      // By the time React's synthetic onClick fires, the browser has
      // already toggled `target.checked` (the property). Apply that state
      // to the *stored* HTML rather than serialising the live DOM: the
      // effect below rewrites image srcs at runtime and those must never
      // reach the saved text. Item order is identical in both because the
      // DOM was rendered from sanitizeHtml(html).
      const li = target.closest('li[data-type="taskItem"]');
      const items = containerRef.current?.querySelectorAll('li[data-type="taskItem"]');
      const index = li && items ? Array.from(items).indexOf(li) : -1;
      if (index >= 0) {
        const next = setTaskItemChecked(sanitizeHtml(html), index, target.checked);
        if (next) void onSave(next);
      }
      return;
    }

    const img = target.closest('img');
    const source = img && inlineImageSource(img.getAttribute('src'), img.getAttribute('data-src'));
    if (source?.kind === 'attachment') {
      e.preventDefault();
      e.stopPropagation();
      setPreview({
        taskServerId: source.taskServerId,
        attachmentServerId: source.attachmentServerId,
        fileName: img!.getAttribute('alt') || 'image',
      });
      return;
    }
    onLinkClickOpenExternal(e);
  };

  // Auth-fetch any inline images that reference our server. The
  // sanitised HTML lands in the DOM as-is with either
  //   <img data-src="<server>/.../attachments/<id>" src="#">  (current)
  // or, for older / pre-VikunjaImage text:
  //   <img src="<server>/.../attachments/<id>">
  // In the first case the browser does nothing (src is just '#'); in
  // the second the browser fires a no-auth fetch that 401s before we
  // can intercept, but we can still detect and replace. Either way
  // we end up with `img.src = <object-url>` after the auth fetch.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll('img'));
    let cancelled = false;
    for (const img of imgs) {
      const rawSrc = img.getAttribute('src');
      const dataSrc = img.getAttribute('data-src');
      // An image whose upload is still queued renders from local bytes.
      const source = inlineImageSource(rawSrc, dataSrc);
      if (!source) continue;
      // Older text keeps the URL in `src` alone: copy it to `data-src`
      // before the swap, so a click still opens the lightbox and a re-run
      // still resolves it. DOM only; never saved (see the checkbox path).
      if (dataSrc === null && rawSrc !== null) img.setAttribute('data-src', rawSrc);
      // Suppress the browser's pending no-auth fetch immediately —
      // this also clears the broken-image icon while we resolve.
      if (rawSrc !== '#') img.src = '#';
      void inlineImageObjectUrl(source).then(
        (url) => {
          if (!cancelled) img.src = url;
        },
        (err) => console.warn('[RichTextView] inline image fetch failed:', err),
      );
    }
    return () => {
      cancelled = true;
    };
    // Re-run when the html or task changes.
  }, [html, taskServerId]);

  return (
    <>
      <div
        ref={containerRef}
        role="presentation"
        className={className ? `selectable ${className}` : "selectable"}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
        onClick={onContainerClick}
      />
      {preview ? (
        <ImageLightbox
          taskServerId={preview.taskServerId}
          attachmentServerId={preview.attachmentServerId}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}

const DESCRIPTION_CLASS =
  'prose prose-sm max-w-none break-words text-sm leading-relaxed [&_a]:cursor-pointer [&_a]:underline [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_pre]:rounded [&_pre]:bg-[var(--color-muted)] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:font-mono [&_pre]:text-xs [&_u]:underline [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-center [&_ul[data-type=taskList]_li]:gap-1.5 [&_ul[data-type=taskList]_li>label]:flex [&_ul[data-type=taskList]_li>label]:items-start [&_ul[data-type=taskList]_li>label]:gap-1.5 [&_ul[data-type=taskList]_li>label>input]:shrink-0 [&_ul[data-type=taskList]_li>label>input]:accent-[var(--color-primary)] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md cursor-default';

export function ReadView({
  value,
  onEdit,
  taskServerId,
  onSave,
}: {
  value: string | null;
  onEdit: () => void;
  taskServerId: number | null;
  /** Same shape as EditView's onSave. We need it here so checkbox
   * toggles in rendered task-lists persist without forcing the user
   * to enter edit mode. */
  onSave: (html: string) => Promise<void>;
}) {
  const editBtn = (
    <button
      type="button"
      onClick={onEdit}
      aria-label="Edit description"
      title="Edit description"
      className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-sm transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );

  if (!value || isEmptyDescription(value)) {
    return (
      <div className="min-w-0 max-w-full space-y-2">
        <button
          type="button"
          onClick={onEdit}
          className="w-full rounded-md border border-dashed border-[var(--color-border)] p-3 text-left text-sm italic text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
        >
          Add a description…
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-2">
      <RichTextView
        html={value}
        className={DESCRIPTION_CLASS}
        taskServerId={taskServerId}
        onSave={onSave}
      />
      <div className="flex items-center justify-start">
        {editBtn}
      </div>
    </div>
  );
}
