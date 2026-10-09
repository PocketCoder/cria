/**
 * Placeholder `<img>` source for an image whose upload is still queued.
 *
 * Pasting or dropping an image into a description queues the upload through
 * the outbox, so there is no server attachment URL yet. The editor inserts
 * `cria://pending/{attachmentLocalId}` instead; the VikunjaImage extension and
 * the read view render it from the local side-store bytes. Once the upload
 * lands, the push executor swaps every reference for the real
 * `<api>/tasks/{id}/attachments/{id}` URL (and the task/comment push swaps any
 * stragglers), so the server should never keep one.
 *
 * Local ids are nanoids (`[A-Za-z0-9_-]`), so a reference needs no escaping
 * in HTML. Matching stops at the end of the id, so one id that happens to
 * prefix another can't be rewritten by mistake.
 */

export const PENDING_REF_PREFIX = 'cria://pending/';

const ID_CHARS = 'A-Za-z0-9_-';
const REF_RE = new RegExp(`cria://pending/([${ID_CHARS}]+)`, 'g');

/** `cria://pending/{localId}` */
export function pendingAttachmentRef(attachmentLocalId: string): string {
  return `${PENDING_REF_PREFIX}${attachmentLocalId}`;
}

/** The attachment local id in a pending reference, or null. */
export function parsePendingAttachmentRef(src: string | null | undefined): string | null {
  if (!src?.startsWith(PENDING_REF_PREFIX)) return null;
  const id = src.slice(PENDING_REF_PREFIX.length);
  return new RegExp(`^[${ID_CHARS}]+$`).test(id) ? id : null;
}

/** Distinct attachment local ids referenced anywhere in `html`. */
export function findPendingAttachmentRefs(html: string | null | undefined): string[] {
  if (!html || !html.includes(PENDING_REF_PREFIX)) return [];
  const ids = new Set<string>();
  for (const m of html.matchAll(REF_RE)) ids.add(m[1]!);
  return [...ids];
}

/** Replace every reference to `attachmentLocalId` with `url`. */
export function replacePendingAttachmentRef(
  html: string,
  attachmentLocalId: string,
  url: string,
): string {
  return html.replace(REF_RE, (whole, id: string) => (id === attachmentLocalId ? url : whole));
}
