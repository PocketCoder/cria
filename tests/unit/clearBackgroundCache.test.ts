import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listBlobs, deleteBlob } = vi.hoisted(() => ({ listBlobs: vi.fn(), deleteBlob: vi.fn() }));
vi.mock('@/tauri/blobStore', () => ({ listBlobs, deleteBlob }));

import { clearProjectBackgroundCache } from '@/lib/clearBackgroundCache';
import { projectServerIdOfBlob } from '@/tauri/blobIds';

beforeEach(() => {
  vi.clearAllMocks();
  deleteBlob.mockResolvedValue(undefined);
});

describe('clearProjectBackgroundCache', () => {
  it('deletes only cache blobs', async () => {
    listBlobs.mockResolvedValue([{ id: 'project-bg-1' }, { id: 'att_x' }, { id: 'project-bg-2' }]);
    await clearProjectBackgroundCache();
    expect(deleteBlob.mock.calls.map(([id]) => id)).toEqual(['project-bg-1', 'project-bg-2']);
  });

  it('never rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    listBlobs.mockRejectedValue(new Error('io'));
    await expect(clearProjectBackgroundCache()).resolves.toBeUndefined();
  });
});

describe('projectServerIdOfBlob', () => {
  it('parses cache ids and rejects others', () => {
    expect(projectServerIdOfBlob('project-bg-12')).toBe(12);
    expect(projectServerIdOfBlob('project-bg-x')).toBeNull();
    expect(projectServerIdOfBlob('project-bg-0')).toBeNull();
    expect(projectServerIdOfBlob('att_1')).toBeNull();
  });
});
