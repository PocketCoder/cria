import { useEffect, useState, useRef } from 'react';
import { Pencil } from 'lucide-react';
import { getAttachmentObjectUrl } from './tiptapImageExtension';
import { isAttachmentUrl, parseAttachmentUrl } from '@/sync/attachments';
import { ImageLightbox } from './ImageLightbox';
import { sanitizeHtml } from '@/lib/sanitize';
import { onLinkClickOpenExternal } from '@/lib/openExternal';
import { isEmptyDescription } from './editorLogic';

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<{
    taskServerId: number;
    attachmentServerId: number;
    fileName: string;
  } | null>(null);

  /**
   * Container click dispatch for rendered descriptions.
   *
   * 1. **Task-list checkbox** → toggle + serialize + save in place.
   *    There's no TipTap editor in ReadView (the description is just
   *    sanitised HTML through dangerouslySetInnerHTML), so we have to
   *    mutate the DOM ourselves and call onSave directly. We
   *    preventDefault before the browser's own toggle runs so the
   *    attribute/property pair stays in sync — otherwise innerHTML
   *    serialisation reads the old attribute and the toggle reverts on
   *    the next refetch.
   * 2. **Inline image** → open the lightbox (same `<img>` walk as
   *    before).
   * 3. **Anchor** → route through `onLinkClickOpenExternal` to open
   *    in the OS browser.
   */
  const onContainerClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;

    if (
      target instanceof HTMLInputElement &&
      target.type === 'checkbox' &&
      target.closest('li[data-type="taskItem"]')
    ) {
      // By the time React's synthetic onClick fires, the browser has
      // already toggled `target.checked` (the property). What hasn't
      // synced is the `checked` *attribute* — and that's what
      // innerHTML serialisation reads. Mirror property → attribute so
      // the saved HTML reflects the new state, then update the LI's
      // data-checked so TipTap parses it back correctly on next pull.
      const newChecked = target.checked;
      if (newChecked) target.setAttribute('checked', 'checked');
      else target.removeAttribute('checked');
      const li = target.closest('li[data-type="taskItem"]') as HTMLElement;
      li.setAttribute('data-checked', String(newChecked));
      const html = containerRef.current?.innerHTML;
      if (html) void onSave(html);
      return;
    }

    const img = target.closest('img');
    if (img) {
      const dataSrc = img.getAttribute('data-src');
      const rawSrc = img.getAttribute('src');
      const realSrc = dataSrc ?? rawSrc ?? '';
      if (isAttachmentUrl(realSrc)) {
        const parsed = parseAttachmentUrl(realSrc);
        if (parsed) {
          e.preventDefault();
          e.stopPropagation();
          setPreview({
            taskServerId: parsed.taskServerId,
            attachmentServerId: parsed.attachmentServerId,
            fileName: img.getAttribute('alt') || 'image',
          });
          return;
        }
      }
    }
    onLinkClickOpenExternal(e);
  };

  // Auth-fetch any inline images that reference our server. The
  // sanitised HTML lands in the DOM as-is with either
  //   <img data-src="<server>/.../attachments/<id>" src="#">  (current)
  // or, for older / pre-VikunjaImage descriptions:
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
      const dataSrc = img.getAttribute('data-src');
      const rawSrc = img.getAttribute('src');
      const realSrc = dataSrc ?? rawSrc;
      if (!realSrc || !isAttachmentUrl(realSrc)) continue;
      const parsed = parseAttachmentUrl(realSrc);
      if (!parsed) continue;
      // Suppress the browser's pending no-auth fetch immediately —
      // this also clears the broken-image icon while we resolve.
      if (rawSrc !== '#') img.src = '#';
      void getAttachmentObjectUrl(parsed.taskServerId, parsed.attachmentServerId).then(
        (url) => {
          if (!cancelled) img.src = url;
        },
        (err) => console.warn('[ReadView] inline image fetch failed:', err),
      );
    }
    return () => {
      cancelled = true;
    };
    // Re-run when the description html or task changes.
  }, [value, taskServerId]);

  const editBtn = (
    <button
      type="button"
      onClick={onEdit}
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
      <div
        ref={containerRef}
        className="prose prose-sm max-w-none break-words text-sm leading-relaxed [&_a]:cursor-pointer [&_a]:underline [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-[var(--color-muted)] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_pre]:rounded [&_pre]:bg-[var(--color-muted)] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:font-mono [&_pre]:text-xs [&_u]:underline [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-center [&_ul[data-type=taskList]_li]:gap-1.5 [&_ul[data-type=taskList]_li>label]:flex [&_ul[data-type=taskList]_li>label]:items-start [&_ul[data-type=taskList]_li>label]:gap-1.5 [&_ul[data-type=taskList]_li>label>input]:shrink-0 [&_ul[data-type=taskList]_li>label>input]:accent-[var(--color-primary)] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md cursor-default"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }}
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
      <div className="flex items-center justify-start">
        {editBtn}
      </div>
    </div>
  );
}
