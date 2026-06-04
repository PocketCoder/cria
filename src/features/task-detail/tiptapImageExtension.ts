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

async function resolveBlobUrl(
  taskServerId: number,
  attServerId: number,
): Promise<string> {
  const key = cacheKey(taskServerId, attServerId);
  const cached = blobCache.get(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const blob = await fetchAttachmentBlob(taskServerId, attServerId);
      const url = URL.createObjectURL(blob);
      blobCache.set(key, url);
      return url;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
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

    // Only swap for *our* server's attachment URLs. External `<img>`
    // (e.g. pasted from elsewhere) go straight through.
    if (!isAttachmentUrl(realSrc)) {
      return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
    }

    const parsed = parseAttachmentUrl(realSrc!);
    if (!parsed) {
      return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
    }

    const id = `cria-img-${parsed.taskServerId}-${parsed.attachmentServerId}`;

    // Kick off (or hit cache for) the auth fetch. `queueMicrotask`
    // because the `<img>` won't exist in the DOM until after this
    // function returns.
    queueMicrotask(() => {
      void resolveBlobUrl(parsed.taskServerId, parsed.attachmentServerId).then(
        (url) => {
          const img = document.getElementById(id);
          if (img instanceof HTMLImageElement) img.src = url;
        },
        (err) => {
          console.warn('[VikunjaImage] auth-fetch failed:', err);
        },
      );
    });

    return [
      'img',
      mergeAttributes(this.options.HTMLAttributes, {
        // src='#' is the do-nothing placeholder; the browser will not
        // attempt a network fetch on the # fragment.
        src: '#',
        'data-src': realSrc,
        alt: HTMLAttributes.alt,
        title: HTMLAttributes.title,
        id,
      }),
    ];
  },
});
