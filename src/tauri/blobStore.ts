/**
 * File-bytes side-store for queued attachment uploads, backed by the Rust
 * `blob_*` commands (src-tauri/src/blobs.rs): one file per attachment in the
 * app data dir, keyed by the attachment's local id. Bytes cross the IPC
 * bridge raw, not as base64 JSON.
 *
 * Outside Tauri (the `pnpm vite` browser dev server, tests) there is no Rust
 * side, so bytes live in an in-memory map instead. That fallback doesn't
 * survive a reload, which is fine for a dev-only path; the real app always
 * has the on-disk store.
 */

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const memory = new Map<string, Uint8Array<ArrayBuffer>>();

async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown> | Uint8Array,
  options?: { headers: Record<string, string> },
): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args, options);
}

/** Persist `bytes` under `id`, replacing any previous blob with that id. */
export async function writeBlob(id: string, bytes: Uint8Array): Promise<void> {
  if (!isTauri()) {
    memory.set(id, bytes.slice());
    return;
  }
  await invoke('blob_write', bytes, { headers: { 'x-blob-id': id } });
}

/** The bytes stored under `id`. Rejects if there are none (see isBlobMissing). */
export async function readBlob(id: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!isTauri()) {
    const bytes = memory.get(id);
    if (!bytes) throw new Error(`blob not found: ${id}`);
    return bytes.slice();
  }
  // Binary responses arrive as an ArrayBuffer over the custom-protocol IPC,
  // or as a number array over the postMessage fallback.
  const data = await invoke<ArrayBuffer | number[]>('blob_read', { id });
  return data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
}

/** Remove the blob under `id`. A missing blob is not an error. */
export async function deleteBlob(id: string): Promise<void> {
  if (!isTauri()) {
    memory.delete(id);
    return;
  }
  await invoke('blob_delete', { id });
}

/** True when a readBlob rejection means the bytes are gone for good (as
 * opposed to a transient I/O or IPC failure worth retrying). */
export function isBlobMissing(err: unknown): boolean {
  return /blob not found/i.test(String(err instanceof Error ? err.message : err));
}
