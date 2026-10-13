/**
 * Object URLs for images that need more than a plain `<img src>`: server
 * attachments (the download needs the Bearer token) and queued uploads (the
 * bytes are still in the local side-store). Shared by the VikunjaImage editor
 * extension, the read-only rich-text view (descriptions and comments), the
 * attachment thumbnails and the lightbox, so each image is fetched once.
 *
 * No TipTap in here: the read-only paths import it without pulling in the
 * editor.
 */
import { fetchAttachmentBlob, type InlineImageSource } from '@/sync/attachments';
import { getAttachmentByLocalId } from '@/db/attachments';
import { readBlob } from '@/tauri/blobStore';

/**
 * LRU cache for blob URLs. Evicts the least-recently-accessed entry
 * when at capacity, revoking its object URL to free the underlying
 * blob memory. Entries are re-ordered on every `get` / `set`.
 *
 * Capacity chosen so the most-recently-viewed ~50 inline images stay
 * hot (typical session: ~10–20 across open tasks), while memory is
 * bounded. An evicted image re-fetches transparently on next view
 * (same `cachedObjectUrl` path, inflight-deduped).
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

/**
 * Object URL for a server attachment: the cached one if it's already been
 * loaded, else an auth fetch.
 */
export function getAttachmentObjectUrl(
  taskServerId: number,
  attServerId: number,
): Promise<string> {
  return cachedObjectUrl(cacheKey(taskServerId, attServerId), () =>
    fetchAttachmentBlob(taskServerId, attServerId),
  );
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
    return getAttachmentObjectUrl(att.taskServerId, att.serverId);
  }
  return cachedObjectUrl(`pending-${localId}`, async () => {
    const bytes = await readBlob(att?.bytesPath ?? localId);
    return new Blob([bytes], { type: att?.mime ?? '' });
  });
}

/** Object URL for an inline image (see `inlineImageSource`). */
export function inlineImageObjectUrl(source: InlineImageSource): Promise<string> {
  return source.kind === 'pending'
    ? getPendingAttachmentObjectUrl(source.attachmentLocalId)
    : getAttachmentObjectUrl(source.taskServerId, source.attachmentServerId);
}
