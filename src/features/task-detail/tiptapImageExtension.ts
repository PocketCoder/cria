/**
 * Vikunja-compatible inline-image extension for TipTap.
 *
 * The problem this solves — the one that defeated issue #38: Vikunja
 * stores inline images as `<img src="{api}/tasks/{id}/attachments/{id}">`
 * in the task description. The download endpoint requires a Bearer
 * token, so the browser's own `<img>` fetch gets a 401 and shows a
 * broken icon.
 *
 * The fix — exactly what Vikunja's web client does
 * (`frontend/src/components/input/editor/TipTap.vue`): we override
 * `renderHTML`. When the src points at our server, we emit
 *   `<img src="#" data-src="<real-url>" id="cria-img-<task>-<att>">`
 * so the browser does NOT try to load the unauthenticated URL, then in
 * `nextTick` we fetch the blob via Tauri-HTTP-with-auth, wrap it in an
 * object URL, and swap it into `img.src`. Results cache per
 * `<task>-<att>` pair (./inlineImageUrls.ts, shared with the read view)
 * so re-renders / scroll-back are free.
 *
 * Cross-client interop falls out for free: the HTML stored on the
 * server is the same shape Vikunja-web produces, so both clients see
 * the same description and both render the same image. The wire is the
 * source of truth.
 *
 * Queued uploads: an image pasted while its upload waits in the outbox is
 * stored as `cria://pending/{localId}` and rendered the same deferred way,
 * from the side-store bytes (see src/lib/pendingAttachmentRef.ts).
 */
import Image from '@tiptap/extension-image';
// `mergeAttributes` lives in @tiptap/core; @tiptap/react re-exports the
// core surface (`export * from '@tiptap/core'`), so importing through
// react avoids adding @tiptap/core as a direct dep.
import { mergeAttributes } from '@tiptap/react';
import { inlineImageSource } from '@/sync/attachments';
import { inlineImageObjectUrl } from './inlineImageUrls';

/**
 * Placeholder `<img>` whose real source is loaded after render: `src='#'`
 * stops the browser fetching `data-src` itself (no auth, or a scheme it
 * can't load), and once `resolve` settles the object URL is swapped in.
 * `queueMicrotask` because the `<img>` won't exist in the DOM until after
 * renderHTML returns.
 */
function deferredImg(
  baseAttrs: Record<string, unknown>,
  HTMLAttributes: Record<string, unknown>,
  realSrc: string,
  id: string,
  resolve: () => Promise<string>,
): ['img', Record<string, unknown>] {
  queueMicrotask(() => {
    void resolve().then(
      (url) => {
        const img = document.getElementById(id);
        if (img instanceof HTMLImageElement) img.src = url;
      },
      (err) => {
        console.warn('[VikunjaImage] image load failed:', err);
      },
    );
  });

  return [
    'img',
    mergeAttributes(baseAttrs, {
      // src='#' is the do-nothing placeholder; the browser will not
      // attempt a network fetch on the # fragment.
      src: '#',
      'data-src': realSrc,
      alt: HTMLAttributes.alt,
      title: HTMLAttributes.title,
      id,
    }),
  ];
}

export const VikunjaImage = Image.extend({
  // Round-trip the data-src attr so it survives setContent / getHTML.
  addAttributes() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      'data-src': {
        default: null,
        // Re-render `data-src` from `src` if only `src` was set (e.g.
        // when the editor's `setImage` command is used by the upload
        // path — we feed it the real URL via src).
        renderHTML: (attrs) => {
          const v = attrs['data-src'] ?? attrs.src;
          return v ? { 'data-src': v } : {};
        },
        parseHTML: (el) => el.getAttribute('data-src'),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const src = HTMLAttributes.src as string | undefined;
    const dataSrc = HTMLAttributes['data-src'] as string | undefined;
    const source = inlineImageSource(src, dataSrc);

    // Only swap for *our* server's attachment URLs and queued uploads.
    // External `<img>` (e.g. pasted from elsewhere) go straight through.
    if (!source) {
      return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
    }

    // Kick off (or hit cache for) the auth fetch or the local-bytes read.
    return deferredImg(
      this.options.HTMLAttributes,
      HTMLAttributes,
      (dataSrc ?? src)!,
      source.kind === 'pending'
        ? `cria-img-pending-${source.attachmentLocalId}`
        : `cria-img-${source.taskServerId}-${source.attachmentServerId}`,
      () => inlineImageObjectUrl(source),
    );
  },
});
