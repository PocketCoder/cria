// Outbox executor for queued attachment uploads (`task_attachment`·`upload`):
// success, backoff/dead-letter classification, dependency waits, crash
// idempotency and the inline `cria://pending/{id}` description rewrite.
//
// The Tauri side-store is mocked with an in-memory map and the multipart PUT
// with a stubbed platformFetch; the DB and outbox drain run for real.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { blobs, platformFetch } = vi.hoisted(() => ({
  blobs: new Map<string, Uint8Array>(),
  platformFetch: vi.fn(),
}));

vi.mock('@/tauri/blobStore', () => ({
  writeBlob: vi.fn(async (id: string, bytes: Uint8Array) => {
    blobs.set(id, bytes.slice());
  }),
  readBlob: vi.fn(async (id: string) => {
    const bytes = blobs.get(id);
    if (!bytes) throw new Error(`blob not found: ${id}`);
    return bytes.slice();
  }),
  deleteBlob: vi.fn(async (id: string) => {
    blobs.delete(id);
  }),
  isBlobMissing: (err: unknown) => /blob not found/.test(String(err)),
}));

vi.mock('@/auth/store', () => ({
  getAuthSnapshot: () => ({ serverUrl: 'https://vik.example', token: 'tok' }),
  useAuth: { getState: () => ({ status: { kind: 'unauthenticated' } }) },
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  platformFetch: (...args: unknown[]) => platformFetch(...args),
}));

import { getDb } from '@/db';
import { initSchema, clearTables } from './_helpers';
import { drainOutbox } from '@/sync/push';
import { cancelAttachmentUpload, queueAttachmentUpload } from '@/sync/attachments';
import {
  ATTACHMENT_ENTITY,
  ATTACHMENT_UPLOAD_OP,
  insertPendingAttachment,
  listAttachmentsForTask,
} from '@/db/attachments';
import { createTask, updateTask, getTaskByLocalId } from '@/db/tasks';
import { pendingAttachmentRef } from '@/lib/pendingAttachmentRef';
import type { ApiClient } from '@/api/client';

const SERVER_URL_7 = 'https://vik.example/api/v1/tasks/42/attachments/7';

function uploadOk(): Response {
  return new Response(
    JSON.stringify({
      success: [
        {
          id: 7,
          task_id: 42,
          created: '2026-07-01T00:00:00Z',
          file: { id: 70, name: 'photo.png', size: 3, mime: 'image/png' },
        },
      ],
      errors: null, // as upstream sends it when nothing failed
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function mockClient() {
  const ok = { ok: true, status: 200 } as Response;
  const now = '2026-07-01T00:00:00Z';
  return {
    GET: vi.fn(async () => ({ data: {}, response: ok })),
    PUT: vi.fn(async () => ({ data: { id: 42, updated: now }, response: ok })),
    POST: vi.fn(async () => ({ data: { updated: now }, response: ok })),
    DELETE: vi.fn(async () => ({ data: undefined, response: { ok: true, status: 204 } })),
  } as unknown as ApiClient & {
    PUT: ReturnType<typeof vi.fn>;
    POST: ReturnType<typeof vi.fn>;
  };
}

function photo(): File {
  return new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
}

async function seed(taskServerId: number | null = 42, description: string | null = null) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES ('proj1', 1, 'P', ?, 0, 0)`,
    [now],
  );
  await db.execute(
    `INSERT INTO tasks (local_id, server_id, project_local_id, title, description, updated_at, dirty, deleted)
     VALUES ('task1', ?, 'proj1', 'Task', ?, ?, 0, 0)`,
    [taskServerId, description, now],
  );
}

async function outboxRows() {
  const db = await getDb();
  return db.select<
    { entity_type: string; op: string; attempts: number; last_error: string | null; next_attempt_at: string | null; payload: string }[]
  >(`SELECT * FROM outbox ORDER BY id`);
}

async function deadLetters() {
  const db = await getDb();
  return db.select<{ entity_type: string; last_error: string }[]>(`SELECT * FROM outbox_dead_letter`);
}

/** Pretend the backoff has elapsed so the next drain retries the head op. */
async function expireBackoff() {
  const db = await getDb();
  await db.execute(`UPDATE outbox SET next_attempt_at = NULL`);
}

describe('sync/push/attachment', () => {
  beforeAll(initSchema);
  beforeEach(async () => {
    await clearTables();
    blobs.clear();
    platformFetch.mockReset();
  });

  it('uploads a queued file, finalises the row and deletes the bytes', async () => {
    await seed();
    const localId = await queueAttachmentUpload('task1', photo());
    expect(blobs.has(localId)).toBe(true);
    expect((await listAttachmentsForTask('task1'))[0]).toMatchObject({ localId, pending: true });

    platformFetch.mockResolvedValueOnce(uploadOk());
    await drainOutbox(mockClient());

    expect(platformFetch).toHaveBeenCalledTimes(1);
    const [url, init] = platformFetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://vik.example/api/v1/tasks/42/attachments');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    const file = (init.body as FormData).get('files') as File;
    expect(file.name).toBe('photo.png');
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(3);
    // What reaches the server once serialised (the Tauri HTTP plugin builds a
    // Request the same way): upstream's v1 handler reads form.File["files"]
    // and takes the stored name from the part's filename. No Content-Type is
    // set by hand, so the generated multipart boundary survives.
    const wire = new Request(url, init);
    expect(wire.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    expect(await wire.text()).toContain('Content-Disposition: form-data; name="files"; filename="photo.png"');

    expect(await listAttachmentsForTask('task1')).toEqual([
      expect.objectContaining({ localId, serverId: 7, fileId: 70, pending: false, uploadFailed: false }),
    ]);
    expect(await outboxRows()).toEqual([]);
    expect(blobs.has(localId)).toBe(false);
  });

  it('backs off while offline, keeping row and bytes, then uploads on reconnect', async () => {
    await seed();
    const localId = await queueAttachmentUpload('task1', photo());

    platformFetch.mockRejectedValueOnce(new TypeError('error sending request for url'));
    await drainOutbox(mockClient());

    const [op] = await outboxRows();
    expect(op).toMatchObject({ entity_type: ATTACHMENT_ENTITY, op: ATTACHMENT_UPLOAD_OP, attempts: 1 });
    expect(op!.last_error).toMatch(/error sending request/);
    expect(op!.next_attempt_at! > new Date().toISOString()).toBe(true);
    expect((await listAttachmentsForTask('task1'))[0]).toMatchObject({ pending: true, uploadFailed: false });
    expect(blobs.has(localId)).toBe(true);
    expect(await deadLetters()).toEqual([]);

    await expireBackoff();
    platformFetch.mockResolvedValueOnce(uploadOk());
    await drainOutbox(mockClient());

    expect((await listAttachmentsForTask('task1'))[0]).toMatchObject({ serverId: 7, pending: false });
    expect(await outboxRows()).toEqual([]);
  });

  it('retries a 5xx but dead-letters a 4xx, flagging the row as failed', async () => {
    await seed();
    const localId = await queueAttachmentUpload('task1', photo());

    platformFetch.mockResolvedValueOnce(new Response('busy', { status: 503 }));
    await drainOutbox(mockClient());
    expect((await outboxRows())[0]).toMatchObject({ attempts: 1 });

    await expireBackoff();
    platformFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 4011, message: 'file too large' }), { status: 413 }),
    );
    await drainOutbox(mockClient());

    expect(await outboxRows()).toEqual([]);
    const [dl] = await deadLetters();
    expect(dl).toMatchObject({ entity_type: ATTACHMENT_ENTITY });
    expect(dl!.last_error).toMatch(/file too large/);
    expect((await listAttachmentsForTask('task1'))[0]).toMatchObject({ pending: true, uploadFailed: true });
    // Kept, so a retry from the dead-letter list can still upload.
    expect(blobs.has(localId)).toBe(true);
  });

  it('treats a file the server rejects inside a 200 as permanent', async () => {
    await seed();
    await queueAttachmentUpload('task1', photo());
    platformFetch.mockResolvedValueOnce(
      // Upstream serialises an empty Go slice as null.
      new Response(JSON.stringify({ success: null, errors: [{ code: 4035, message: 'too big' }] }), { status: 200 }),
    );
    await drainOutbox(mockClient());
    expect((await deadLetters())[0]!.last_error).toMatch(/upload rejected: too big/);
  });

  it('waits for an unsynced task, then uploads once its create has landed', async () => {
    const db = await getDb();
    await db.execute(
      `INSERT INTO projects (local_id, server_id, title, updated_at, dirty, deleted) VALUES ('proj1', 1, 'P', ?, 0, 0)`,
      [new Date().toISOString()],
    );
    const task = await createTask({ title: 'Offline task', projectLocalId: 'proj1' });
    const localId = await queueAttachmentUpload(task.localId, photo());

    // On its own (the create op discarded), the upload is a dependency wait:
    // no request, no attempt counted.
    await db.execute(`DELETE FROM outbox WHERE entity_type = 'task'`);
    await drainOutbox(mockClient());
    expect(platformFetch).not.toHaveBeenCalled();
    expect((await outboxRows())[0]).toMatchObject({ entity_type: ATTACHMENT_ENTITY, attempts: 0 });

    // With the create queued first (the normal order), one drain does both.
    await db.execute(`DELETE FROM outbox`);
    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at) VALUES ('task', ?, 'create', '{}', ?)`,
      [task.localId, new Date().toISOString()],
    );
    await insertPendingAttachment({
      taskLocalId: task.localId,
      attachmentLocalId: 'att2',
      fileName: 'photo.png',
      mime: 'image/png',
      size: 3,
      bytesPath: localId,
    });
    platformFetch.mockResolvedValueOnce(uploadOk());
    const client = mockClient();
    await drainOutbox(client);

    expect(client.PUT).toHaveBeenCalledWith('/projects/{id}/tasks', expect.anything());
    expect(platformFetch.mock.calls[0]![0]).toBe('https://vik.example/api/v1/tasks/42/attachments');
    expect((await listAttachmentsForTask(task.localId)).find((a) => a.localId === 'att2')).toMatchObject({
      serverId: 7,
      pending: false,
    });
  });

  it('rewrites the inline placeholder so the queued description update sends the real URL', async () => {
    await seed();
    const localId = await queueAttachmentUpload('task1', photo());
    // The user saves the description with the placeholder before reconnecting.
    await updateTask('task1', {
      description: `<p><img src="#" data-src="${pendingAttachmentRef(localId)}"></p>`,
    });

    platformFetch.mockResolvedValueOnce(uploadOk());
    const client = mockClient();
    await drainOutbox(client);

    const expected = `<p><img src="#" data-src="${SERVER_URL_7}"></p>`;
    expect((await getTaskByLocalId('task1'))!.description).toBe(expected);
    expect(client.POST).toHaveBeenCalledTimes(1);
    expect(client.POST.mock.calls[0]![1].body.description).toBe(expected);
    expect(await outboxRows()).toEqual([]);
  });

  it('pushes the rewrite when the placeholder had already reached the server', async () => {
    await seed(42, '<p><img src="#" data-src="cria://pending/PLACEHOLDER"></p>');
    blobs.set('PLACEHOLDER', new Uint8Array([1, 2, 3]));
    await insertPendingAttachment({
      taskLocalId: 'task1',
      attachmentLocalId: 'PLACEHOLDER',
      fileName: 'photo.png',
      mime: 'image/png',
      size: 3,
      bytesPath: 'PLACEHOLDER',
    });

    platformFetch.mockResolvedValueOnce(uploadOk());
    const client = mockClient();
    await drainOutbox(client);

    expect(client.POST).toHaveBeenCalledTimes(1);
    expect(client.POST.mock.calls[0]![1].body.description).toContain(SERVER_URL_7);
    expect((await getTaskByLocalId('task1'))!.description).toContain(SERVER_URL_7);
  });

  it('pushes a rewritten comment and marks it clean again', async () => {
    await seed();
    const db = await getDb();
    await db.execute(
      `INSERT INTO task_comments (local_id, server_id, task_local_id, comment, updated_at, dirty, deleted)
       VALUES ('c1', 5, 'task1', '<p><img src="#" data-src="cria://pending/PLACEHOLDER"></p>', ?, 0, 0)`,
      [new Date().toISOString()],
    );
    blobs.set('PLACEHOLDER', new Uint8Array([1, 2, 3]));
    await insertPendingAttachment({
      taskLocalId: 'task1',
      attachmentLocalId: 'PLACEHOLDER',
      fileName: 'photo.png',
      mime: 'image/png',
      size: 3,
      bytesPath: 'PLACEHOLDER',
    });

    platformFetch.mockResolvedValueOnce(uploadOk());
    const client = mockClient();
    await drainOutbox(client);

    expect(client.POST).toHaveBeenCalledWith(
      '/tasks/{taskID}/comments/{commentID}',
      expect.objectContaining({ body: { comment: `<p><img src="#" data-src="${SERVER_URL_7}"></p>` } }),
    );
    const [row] = await db.select<{ dirty: number }[]>(`SELECT dirty FROM task_comments WHERE local_id = 'c1'`);
    expect(row!.dirty).toBe(0);
    expect(await outboxRows()).toEqual([]);
  });

  it('swaps a placeholder saved after its upload landed when pushing the task', async () => {
    await seed();
    const localId = await queueAttachmentUpload('task1', photo());
    platformFetch.mockResolvedValueOnce(uploadOk());
    await drainOutbox(mockClient());

    // The editor was still open and saved the placeholder afterwards.
    await updateTask('task1', {
      description: `<p><img src="#" data-src="${pendingAttachmentRef(localId)}"></p>`,
    });
    const client = mockClient();
    await drainOutbox(client);

    expect(client.POST.mock.calls[0]![1].body.description).toBe(
      `<p><img src="#" data-src="${SERVER_URL_7}"></p>`,
    );
  });

  it('finalises from a cached result instead of uploading twice', async () => {
    await seed();
    const localId = await queueAttachmentUpload('task1', photo());
    const db = await getDb();
    const [op] = await outboxRows();
    await db.execute(`UPDATE outbox SET payload = ?`, [
      JSON.stringify({
        ...JSON.parse(op!.payload),
        _uploaded: { id: 7, created: '2026-07-01T00:00:00Z', file: { id: 70, name: 'photo.png' } },
      }),
    ]);

    await drainOutbox(mockClient());

    expect(platformFetch).not.toHaveBeenCalled();
    expect((await listAttachmentsForTask('task1'))[0]).toMatchObject({ localId, serverId: 7, pending: false });
    expect(blobs.has(localId)).toBe(false);
  });

  it('dead-letters an upload whose bytes are gone', async () => {
    await seed();
    await queueAttachmentUpload('task1', photo());
    blobs.clear();

    await drainOutbox(mockClient());

    expect(platformFetch).not.toHaveBeenCalled();
    expect((await deadLetters())[0]!.last_error).toMatch(/missing from the local store/);
  });

  it('drops the upload when its task has been deleted', async () => {
    await seed();
    const localId = await queueAttachmentUpload('task1', photo());
    const db = await getDb();
    await db.execute(`UPDATE tasks SET deleted = 1 WHERE local_id = 'task1'`);

    await drainOutbox(mockClient());

    expect(platformFetch).not.toHaveBeenCalled();
    expect(await listAttachmentsForTask('task1')).toEqual([]);
    expect(await outboxRows()).toEqual([]);
    expect(blobs.has(localId)).toBe(false);
  });

  it('cancelAttachmentUpload removes the row, its op and its bytes', async () => {
    await seed();
    const localId = await queueAttachmentUpload('task1', photo());
    await cancelAttachmentUpload(localId);

    expect(await listAttachmentsForTask('task1')).toEqual([]);
    expect(await outboxRows()).toEqual([]);
    expect(blobs.has(localId)).toBe(false);
  });
});
