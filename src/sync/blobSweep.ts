/**
 * Startup sweep of the attachment side-store (src/tauri/blobStore.ts).
 *
 * Whoever ends a queued upload deletes its bytes: the push executor once the
 * server has the file, cancelAttachmentUpload when the user removes it. A
 * crash between writing the bytes and inserting the row, a delete that
 * failed, or a row dropped some other way leaves the file with nothing that
 * will ever remove it. This clears such leftovers once per launch.
 *
 * A blob is deleted only when both hold:
 *  - it was last written more than BLOB_GRACE_MS ago, so the bytes of a file
 *    being picked right now (written, row not yet inserted) are never touched;
 *  - no attachment row and no outbox or dead-letter op refers to it
 *    (isBlobReferenced).
 * Cache blobs (see isCacheBlobId) are exempt from the age and reference
 * rules; they are deleted only when their project no longer exists.
 * Anything uncertain keeps the file: no modified time, one in the future, a
 * failed lookup. Errors are logged, never thrown, so app start can't fail
 * here.
 */
import { getDb } from '@/db';
import { isBlobReferenced } from '@/db/attachments';
import { deleteBlob, listBlobs, type BlobEntry } from '@/tauri/blobStore';
import { isCacheBlobId, projectServerIdOfBlob } from '@/tauri/blobIds';

/** How old an unreferenced blob must be before the sweep deletes it. */
export const BLOB_GRACE_MS = 24 * 60 * 60 * 1000;

/** Delay after launch, so the sweep stays clear of first render, the
 * initial pull and the outbox drain. */
export const BLOB_SWEEP_DELAY_MS = 30_000;

async function projectExists(serverId: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ one: number }[]>(
    'SELECT 1 AS one FROM projects WHERE server_id = ? AND deleted = 0 LIMIT 1',
    [serverId],
  );
  return rows.length > 0;
}

/** Delete orphaned blobs. Resolves to how many were deleted; never rejects. */
export async function sweepOrphanBlobs(now: number = Date.now()): Promise<number> {
  let entries: BlobEntry[];
  try {
    // getDb resolves once migrations have run; without a DB nothing can be
    // ruled out, so bail before listing anything.
    await getDb();
    entries = await listBlobs();
  } catch (err) {
    console.warn('[blob-sweep] skipped, could not read the store:', err);
    return 0;
  }
  if (!Array.isArray(entries)) return 0;

  let removed = 0;
  for (const entry of entries) {
    if (isCacheBlobId(entry?.id)) {
      // Cache blobs have no row of their own: keep one while its project
      // exists, drop it once the project is gone (deleted here or elsewhere).
      try {
        const serverId = projectServerIdOfBlob(entry.id);
        if (serverId == null || (await projectExists(serverId))) continue;
        await deleteBlob(entry.id);
        removed += 1;
      } catch (err) {
        console.warn(`[blob-sweep] kept ${entry.id}:`, err);
      }
      continue;
    }
    const modified = entry?.modifiedMs;
    if (typeof modified !== 'number' || !Number.isFinite(modified)) continue;
    if (now - modified < BLOB_GRACE_MS) continue;
    try {
      if (await isBlobReferenced(entry.id)) continue;
      await deleteBlob(entry.id);
      removed += 1;
    } catch (err) {
      console.warn(`[blob-sweep] kept ${entry.id}:`, err);
    }
  }
  if (removed > 0) console.info(`[blob-sweep] deleted ${removed} orphaned blob(s)`);
  return removed;
}

/**
 * Run sweepOrphanBlobs once, `delayMs` after the call. Returns a cancel
 * function for an effect cleanup: it stops a sweep that hasn't started, and
 * one already running finishes on its own.
 */
export function scheduleBlobSweep(delayMs: number = BLOB_SWEEP_DELAY_MS): () => void {
  const timer = setTimeout(() => {
    void sweepOrphanBlobs().catch((err) => console.warn('[blob-sweep] failed:', err));
  }, delayMs);
  return () => clearTimeout(timer);
}
