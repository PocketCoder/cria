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
 * `<task>-<att>` pair so re-renders / scroll-back are free.
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
import {
  fetchAttachmentBlob,
  isAttachmentUrl,
  parseAttachmentUrl,
} from '@/sync/attachments';
import { getAttachmentByLocalId } from '@/db/attachments';
import { parsePendingAttachmentRef } from '@/lib/pendingAttachmentRef';
import { readBlob } from '@/tauri/blobStore';

/**
 * LRU cache for blob URLs. Evicts the least-recently-accessed entry
 * when at capacity, revoking its object URL to free the underlying
 * blob memory. Entries are re-ordered on every `get` / `set`.
 *
 * Capacity chosen so the most-recently-viewed ~50 inline images stay
 * hot (typical session: ~10–20 across open tasks), while memory is
 * bounded. An evicted image re-fetches transparently on next view
 * (same `resolveBlobUrl` path, inflight-deduped).
 */
export class LRUMap<K, V extends string> {
  private capacity: number;
  private map: Map<K, V>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.map = new Map();
  }

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        const oldestVal = this.map.get(oldestKey)!;
        URL.revokeObjectURL(oldestVal);
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }

  clear(): void {
    for (const val of this.map.values()) {
      URL.revokeObjectURL(val);
    }
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

const blobCache = new LRUMap<string, string>(50);
/** Pending fetches keyed the same way, so two concurrent renders of
 * the same image don't both go to the network. */
const inflight = new Map<string, Promise<string>>();

function cacheKey(taskServerId: number, attServerId: number): string {
  return `${taskServerId}-${attServerId}`;
}

/** Cached, in-flight-deduped object URL for whatever `load` returns. */
function cachedObjectUrl(key: string, load: () => Promise<Blob>): Promise<string> {
  const cached = blobCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const url = URL.createObjectURL(await load());
      blobCache.set(key, url);
      return url;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

async function resolveBlobUrl(
  taskServerId: number,
  attServerId: number,
): Promise<string> {
  return cachedObjectUrl(cacheKey(taskServerId, attServerId), () =>
    fetchAttachmentBlob(taskServerId, attServerId),
  );
}

/**
 * Bridge for non-extension callers (the lightbox in particular) that
 * want to display the same image without re-fetching. Returns the
 * cached object URL if already loaded, else fetches.
 */
export async function getAttachmentObjectUrl(
  taskServerId: number,
  attServerId: number,
): Promise<string> {
  return resolveBlobUrl(taskServerId, attServerId);
}

/**
 * Object URL for a `cria://pending/{localId}` image (an upload still in the
 * outbox). Before the upload lands the bytes come from the local side-store;
 * after it, from the server like any attachment, because the queued bytes
 * are deleted once uploaded.
 */
export async function getPendingAttachmentObjectUrl(localId: string): Promise<string> {
  const att = await getAttachmentByLocalId(localId);
  if (att?.serverId != null && att.taskServerId != null) {
    return resolveBlobUrl(att.taskServerId, att.serverId);
  }
  return cachedObjectUrl(`pending-${localId}`, async () => {
    const bytes = await readBlob(att?.bytesPath ?? localId);
    return new Blob([bytes], { type: att?.mime ?? '' });
  });
}

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
    const incoming = HTMLAttributes.src;
    const dataSrc = HTMLAttributes['data-src'];
    const realSrc = (dataSrc as string | undefined) ?? (incoming as string | undefined);

    // An image pasted while its upload is queued: render the local bytes.
    const pendingId = parsePendingAttachmentRef(realSrc);
    if (pendingId) {
      return deferredImg(
        this.options.HTMLAttributes,
        HTMLAttributes,
        realSrc!,
        `cria-img-pending-${pendingId}`,
        () => getPendingAttachmentObjectUrl(pendingId),
      );
    }

    // Only swap for *our* server's attachment URLs. External `<img>`
    // (e.g. pasted from elsewhere) go straight through.
    if (!isAttachmentUrl(realSrc)) {
      return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
    }

    const parsed = parseAttachmentUrl(realSrc!);
    if (!parsed) {
      return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
    }

    // Kick off (or hit cache for) the auth fetch.
    return deferredImg(
      this.options.HTMLAttributes,
      HTMLAttributes,
      realSrc!,
      `cria-img-${parsed.taskServerId}-${parsed.attachmentServerId}`,
      () => resolveBlobUrl(parsed.taskServerId, parsed.attachmentServerId),
    );
  },
});
