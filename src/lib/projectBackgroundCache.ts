import { fetchProjectBackground } from '@/api/projects';
import { deleteBlob, readBlob, writeBlob } from '@/tauri/blobStore';
import { projectBackgroundBlobId } from '@/tauri/blobIds';

/**
 * A project's background image, cached in the blob store so it shows offline
 * and straight after launch. Online, the server wins: its image replaces the
 * cached bytes, and "no background" deletes them. If the server can't be
 * reached (or we're offline) the cached copy is used.
 */
export async function loadProjectBackground(
  serverId: number,
  online: boolean,
): Promise<Blob | null> {
  const id = projectBackgroundBlobId(serverId);
  if (online) {
    try {
      const fresh = await fetchProjectBackground(serverId);
      if (fresh) {
        await writeBlob(id, new Uint8Array(await fresh.arrayBuffer())).catch(() => {});
        return fresh;
      }
      await deleteBlob(id).catch(() => {});
      return null;
    } catch {
      // Fall through to the cache.
    }
  }
  try {
    return new Blob([await readBlob(id)]);
  } catch {
    return null;
  }
}
