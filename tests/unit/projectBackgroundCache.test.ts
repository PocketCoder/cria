import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchProjectBackground, writeBlob, readBlob, deleteBlob } = vi.hoisted(() => ({
  fetchProjectBackground: vi.fn(),
  writeBlob: vi.fn(),
  readBlob: vi.fn(),
  deleteBlob: vi.fn(),
}));

vi.mock('@/api/projects', () => ({ fetchProjectBackground }));
vi.mock('@/tauri/blobStore', () => ({ writeBlob, readBlob, deleteBlob }));

import { loadProjectBackground } from '@/lib/projectBackgroundCache';
import { isCacheBlobId, projectBackgroundBlobId } from '@/tauri/blobIds';

beforeEach(() => {
  vi.clearAllMocks();
  writeBlob.mockResolvedValue(undefined);
  deleteBlob.mockResolvedValue(undefined);
});

describe('loadProjectBackground', () => {
  it('online: returns the fresh image and caches its bytes', async () => {
    const fresh = new Blob(['img'], { type: 'image/png' });
    fetchProjectBackground.mockResolvedValue(fresh);
    expect(await loadProjectBackground(7, true)).toBe(fresh);
    expect(writeBlob).toHaveBeenCalledWith('project-bg-7', expect.any(Uint8Array));
  });

  it('online with no background: deletes the cached copy', async () => {
    fetchProjectBackground.mockResolvedValue(null);
    expect(await loadProjectBackground(7, true)).toBeNull();
    expect(deleteBlob).toHaveBeenCalledWith('project-bg-7');
    expect(readBlob).not.toHaveBeenCalled();
  });

  it('a failing cache write still returns the fresh image', async () => {
    const fresh = new Blob(['img']);
    fetchProjectBackground.mockResolvedValue(fresh);
    writeBlob.mockRejectedValue(new Error('disk full'));
    expect(await loadProjectBackground(7, true)).toBe(fresh);
  });

  it('offline: serves the cached bytes without touching the network', async () => {
    readBlob.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const out = await loadProjectBackground(7, false);
    expect(out?.size).toBe(3);
    expect(fetchProjectBackground).not.toHaveBeenCalled();
  });

  it('online but the request fails: falls back to the cache', async () => {
    fetchProjectBackground.mockRejectedValue(new Error('network'));
    readBlob.mockResolvedValue(new Uint8Array([9]));
    expect((await loadProjectBackground(7, true))?.size).toBe(1);
  });

  it('offline with nothing cached is null', async () => {
    readBlob.mockRejectedValue(new Error('blob not found: project-bg-7'));
    expect(await loadProjectBackground(7, false)).toBeNull();
  });
});

describe('cache blob ids', () => {
  it('are recognised so the orphan sweep skips them', () => {
    expect(isCacheBlobId(projectBackgroundBlobId(3))).toBe(true);
    expect(isCacheBlobId('att_abc')).toBe(false);
    expect(isCacheBlobId(undefined)).toBe(false);
  });
});
