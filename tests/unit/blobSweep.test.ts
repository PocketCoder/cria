// Startup sweep of the attachment side-store: which blobs count as orphans,
// and that nothing it hits ever throws. The Tauri side-store is mocked; the
// DB runs for real so the reference checks see actual rows and ops.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const { listBlobs, deleteBlob } = vi.hoisted(() => ({
  listBlobs: vi.fn(),
  deleteBlob: vi.fn(),
}));

vi.mock('@/tauri/blobStore', () => ({ listBlobs, deleteBlob }));

import { getDb } from '@/db';
import { initSchema, clearTables } from './_helpers';
import { ATTACHMENT_ENTITY, ATTACHMENT_UPLOAD_OP, insertPendingAttachment } from '@/db/attachments';
import {
  BLOB_GRACE_MS,
  BLOB_SWEEP_DELAY_MS,
  scheduleBlobSweep,
  sweepOrphanBlobs,
} from '@/sync/blobSweep';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const OLD = NOW - BLOB_GRACE_MS - 60_000;

function stored(...entries: [id: string, modifiedMs: number | null][]) {
  listBlobs.mockResolvedValue(entries.map(([id, modifiedMs]) => ({ id, modifiedMs })));
}

const deleted = () => deleteBlob.mock.calls.map(([id]) => id as string).sort();

async function insertRow(localId: string, pending: 0 | 1, bytesPath: string | null) {
  const db = await getDb();
  await db.execute(
    `INSERT INTO task_attachments (local_id, task_local_id, server_id, file_name, pending, bytes_path)
     VALUES (?, 'task1', ?, 'f.png', ?, ?)`,
    [localId, pending ? null : 7, pending, bytesPath],
  );
}

async function insertOp(table: 'outbox' | 'outbox_dead_letter', entityLocalId: string, payload: string) {
  const db = await getDb();
  if (table === 'outbox') {
    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task', ?, 'update', ?, '2026-10-01T00:00:00Z')`,
      [entityLocalId, payload],
    );
  } else {
    await db.execute(
      `INSERT INTO outbox_dead_letter (entity_type, entity_local_id, op, payload, attempts, failed_at)
       VALUES (?, ?, ?, ?, 5, '2026-10-01T00:00:00Z')`,
      [ATTACHMENT_ENTITY, entityLocalId, ATTACHMENT_UPLOAD_OP, payload],
    );
  }
}

describe('sweepOrphanBlobs', () => {
  beforeAll(async () => {
    await initSchema();
  });

  beforeEach(async () => {
    await clearTables();
    listBlobs.mockReset();
    deleteBlob.mockReset();
    deleteBlob.mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes old blobs nothing refers to', async () => {
    stored(['orphan1', OLD], ['orphan2', OLD - BLOB_GRACE_MS]);
    expect(await sweepOrphanBlobs(NOW)).toBe(2);
    expect(deleted()).toEqual(['orphan1', 'orphan2']);
  });

  it('keeps the bytes of a queued upload (row and op)', async () => {
    await insertPendingAttachment({
      taskLocalId: 'task1',
      attachmentLocalId: 'queued',
      fileName: 'f.png',
      mime: 'image/png',
      size: 3,
      bytesPath: 'queued',
    });
    stored(['queued', OLD], ['orphan', OLD]);
    expect(await sweepOrphanBlobs(NOW)).toBe(1);
    expect(deleted()).toEqual(['orphan']);
  });

  it('keeps blobs a pending row refers to even with no op left', async () => {
    // Failed upload: the op was dead-lettered and dismissed, the row stays
    // pending with its bytes so the user can still retry or remove it.
    await insertRow('failed', 1, 'failed');
    // A pending row's own local id is its key even if bytes_path differs.
    await insertRow('byId', 1, 'elsewhere');
    stored(['failed', OLD], ['byId', OLD], ['elsewhere', OLD]);
    expect(await sweepOrphanBlobs(NOW)).toBe(0);
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it('deletes bytes left behind by an upload that already finished', async () => {
    // Uploaded rows have no bytes_path; a blob under their id is a leftover.
    await insertRow('done', 0, null);
    stored(['done', OLD]);
    expect(await sweepOrphanBlobs(NOW)).toBe(1);
    expect(deleted()).toEqual(['done']);
  });

  it('keeps blobs any outbox or dead-letter op mentions', async () => {
    await insertOp('outbox', 'task1', JSON.stringify({ description: '<img src="cria://pending/inPayload">' }));
    await insertOp('outbox', 'byEntity', '{}');
    await insertOp('outbox_dead_letter', 'deadOp', JSON.stringify({ bytesPath: 'deadBytes' }));
    stored(['inPayload', OLD], ['byEntity', OLD], ['deadOp', OLD], ['deadBytes', OLD], ['orphan', OLD]);
    expect(await sweepOrphanBlobs(NOW)).toBe(1);
    expect(deleted()).toEqual(['orphan']);
  });

  it('keeps recent blobs and ones with no usable modified time', async () => {
    stored(
      ['justPicked', NOW - 60_000],
      ['edge', NOW - BLOB_GRACE_MS + 1],
      ['future', NOW + 60 * 60_000],
      ['unknown', null],
    );
    expect(await sweepOrphanBlobs(NOW)).toBe(0);
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it('never throws when listing fails', async () => {
    listBlobs.mockRejectedValue(new Error('ipc down'));
    await expect(sweepOrphanBlobs(NOW)).resolves.toBe(0);
    expect(deleteBlob).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('carries on past a failed delete', async () => {
    stored(['stuck', OLD], ['orphan', OLD]);
    deleteBlob.mockImplementation(async (id: string) => {
      if (id === 'stuck') throw new Error('permission denied');
    });
    await expect(sweepOrphanBlobs(NOW)).resolves.toBe(1);
    expect(deleted()).toEqual(['orphan', 'stuck']);
    expect(console.warn).toHaveBeenCalled();
  });

  it('ignores a malformed listing', async () => {
    listBlobs.mockResolvedValue({ not: 'an array' });
    await expect(sweepOrphanBlobs(NOW)).resolves.toBe(0);
    listBlobs.mockResolvedValue([null, { id: 'x' }, { id: 'y', modifiedMs: 'old' }]);
    await expect(sweepOrphanBlobs(NOW)).resolves.toBe(0);
    expect(deleteBlob).not.toHaveBeenCalled();
  });
});

describe('scheduleBlobSweep', () => {
  beforeAll(async () => {
    await initSchema();
  });

  beforeEach(async () => {
    await clearTables();
    listBlobs.mockReset();
    listBlobs.mockResolvedValue([]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once, after the delay', async () => {
    scheduleBlobSweep();
    await vi.advanceTimersByTimeAsync(BLOB_SWEEP_DELAY_MS - 1);
    expect(listBlobs).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(listBlobs).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BLOB_SWEEP_DELAY_MS * 10);
    expect(listBlobs).toHaveBeenCalledTimes(1);
  });

  it('does nothing once cancelled', async () => {
    const cancel = scheduleBlobSweep();
    cancel();
    await vi.advanceTimersByTimeAsync(BLOB_SWEEP_DELAY_MS * 2);
    expect(listBlobs).not.toHaveBeenCalled();
  });
});
