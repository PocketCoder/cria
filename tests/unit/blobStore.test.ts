import { afterEach, describe, it, expect, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { deleteBlob, isBlobMissing, readBlob, writeBlob } from '@/tauri/blobStore';

describe('blobStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    invoke.mockReset();
  });

  describe('outside Tauri (in-memory fallback)', () => {
    it('round-trips bytes and deletes them', async () => {
      await writeBlob('a1', new Uint8Array([1, 2, 3]));
      expect(Array.from(await readBlob('a1'))).toEqual([1, 2, 3]);
      await deleteBlob('a1');
      await expect(readBlob('a1')).rejects.toSatisfy(isBlobMissing);
      // Deleting a missing blob is fine.
      await deleteBlob('a1');
      expect(invoke).not.toHaveBeenCalled();
    });

    it('stores a copy, not the caller’s buffer', async () => {
      const bytes = new Uint8Array([9]);
      await writeBlob('a2', bytes);
      bytes[0] = 0;
      expect(Array.from(await readBlob('a2'))).toEqual([9]);
    });
  });

  describe('inside Tauri', () => {
    const tauri = () => vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });

    it('sends raw bytes with the id in a header', async () => {
      tauri();
      const bytes = new Uint8Array([4, 5]);
      await writeBlob('b1', bytes);
      expect(invoke).toHaveBeenCalledWith('blob_write', bytes, { headers: { 'x-blob-id': 'b1' } });
    });

    it('accepts an ArrayBuffer or a number array back', async () => {
      tauri();
      invoke.mockResolvedValueOnce(new Uint8Array([7, 8]).buffer);
      expect(Array.from(await readBlob('b1'))).toEqual([7, 8]);
      invoke.mockResolvedValueOnce([6]);
      expect(Array.from(await readBlob('b1'))).toEqual([6]);
      expect(invoke).toHaveBeenCalledWith('blob_read', { id: 'b1' }, undefined);
    });

    it('deletes through the command', async () => {
      tauri();
      await deleteBlob('b1');
      expect(invoke).toHaveBeenCalledWith('blob_delete', { id: 'b1' }, undefined);
    });
  });

  it('tells missing bytes from other failures', () => {
    expect(isBlobMissing(new Error('blob not found: x'))).toBe(true);
    expect(isBlobMissing('blob not found: x')).toBe(true);
    expect(isBlobMissing(new Error('disk full'))).toBe(false);
  });
});
