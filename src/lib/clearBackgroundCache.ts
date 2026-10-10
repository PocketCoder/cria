import { deleteBlob, listBlobs } from '@/tauri/blobStore';
import { isCacheBlobId } from '@/tauri/blobIds';

/** Drop every cached background (sign-out): they belong to the account's projects. Never rejects. */
export async function clearProjectBackgroundCache(): Promise<void> {
  try {
    for (const { id } of await listBlobs()) {
      if (isCacheBlobId(id)) await deleteBlob(id).catch(() => {});
    }
  } catch (err) {
    console.warn('[bg-cache] could not clear cached backgrounds:', err);
  }
}
