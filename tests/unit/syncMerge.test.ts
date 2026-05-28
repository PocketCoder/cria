// Coverage for src/db/syncMerge.ts.
//
// This file exists because the pull-clobber bug has shipped THREE times:
//   1. pull resurrected locally-deleted rows
//   2. pull clobbered a dirty mid-flight edit (date flash)
//   3. labels clobbered too
//
// Each time the fix went into a different upsertXFromServer copy. The
// refactor in PR #13 centralised the guard into mergeFromServer; this
// test pins the four branches so the bug can't slip a fourth time.

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { getDb } from '@/db';
import { mergeFromServer, type MergeContract } from '@/db/syncMerge';
import { initSchema, clearTables } from './_helpers';

/** Build a project-shaped contract for a given server payload. Projects
 * are the simplest sync entity (no FK resolution) so they're the cleanest
 * vehicle for testing the helper. */
function projectContract(
  serverId: number,
  payload: { title: string; description?: string | null },
): MergeContract {
  const now = new Date().toISOString();
  return {
    entity: 'project',
    serverId,
    remotePayload: { id: serverId, ...payload } as Record<string, unknown>,
    insert: (localId, lastSyncedJson) => ({
      sql: `INSERT INTO projects (
              local_id, server_id, title, description, updated_at,
              synced_at, last_synced, dirty, deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      params: [
        localId,
        serverId,
        payload.title,
        payload.description ?? null,
        now,
        now,
        lastSyncedJson,
      ],
    }),
    update: (localId, lastSyncedJson) => ({
      sql: `UPDATE projects SET
              title       = ?,
              description = ?,
              updated_at  = ?,
              synced_at   = ?,
              last_synced = ?,
              dirty       = 0,
              deleted     = 0
            WHERE local_id = ? AND deleted = 0 AND dirty = 0`,
      params: [
        payload.title,
        payload.description ?? null,
        now,
        now,
        lastSyncedJson,
        localId,
      ],
    }),
  };
}

describe('mergeFromServer', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  it('INSERTs when no local row exists', async () => {
    const id = await mergeFromServer(
      projectContract(100, { title: 'New from server' }),
    );
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/); // nanoid shape

    const db = await getDb();
    const [row] = await db.select<
      { local_id: string; title: string; dirty: number; last_synced: string }[]
    >(`SELECT local_id, title, dirty, last_synced FROM projects WHERE server_id = ?`, [
      100,
    ]);
    expect(row!.local_id).toBe(id);
    expect(row!.title).toBe('New from server');
    expect(row!.dirty).toBe(0);
    // last_synced should be the JSON-stringified remote payload
    expect(JSON.parse(row!.last_synced)).toMatchObject({ id: 100, title: 'New from server' });
  });

  it('UPDATEs a clean local row from the server payload', async () => {
    // First pull creates the row.
    const id = await mergeFromServer(
      projectContract(200, { title: 'v1' }),
    );
    // Second pull with new payload.
    const id2 = await mergeFromServer(
      projectContract(200, { title: 'v2 from server' }),
    );
    expect(id2).toBe(id);

    const db = await getDb();
    const [row] = await db.select<{ title: string; dirty: number }[]>(
      `SELECT title, dirty FROM projects WHERE local_id = ?`,
      [id],
    );
    expect(row!.title).toBe('v2 from server');
    expect(row!.dirty).toBe(0);
  });

  it('SKIPs writing when the local row is dirty — outbox is authoritative', async () => {
    // Initial clean state from a pull.
    const id = await mergeFromServer(
      projectContract(300, { title: 'clean' }),
    );

    // Simulate a user edit: row becomes dirty with a different title.
    const db = await getDb();
    await db.execute(
      `UPDATE projects SET title = ?, dirty = 1 WHERE local_id = ?`,
      ['dirty edit, pending push', id],
    );

    // Another pull races in with the SAME server payload as last_synced
    // (no remote change). Helper must skip — and must not record a
    // conflict because only the local side has diverged.
    const id2 = await mergeFromServer(
      projectContract(300, { title: 'clean' }),
    );
    expect(id2).toBe(id);

    const [row] = await db.select<{ title: string; dirty: number }[]>(
      `SELECT title, dirty FROM projects WHERE local_id = ?`,
      [id],
    );
    expect(row!.title).toBe('dirty edit, pending push'); // local edit preserved
    expect(row!.dirty).toBe(1);

    const conflicts = await db.select<{ id: number }[]>(`SELECT id FROM conflicts`);
    expect(conflicts).toHaveLength(0);
  });

  it('RECORDS a conflict when both local and server diverged from last_synced', async () => {
    const id = await mergeFromServer(
      projectContract(400, { title: 'baseline', description: 'orig' }),
    );

    // Local goes dirty with a new title.
    const db = await getDb();
    await db.execute(
      `UPDATE projects SET title = ?, dirty = 1 WHERE local_id = ?`,
      ['local edit', id],
    );

    // Remote ALSO diverged from the last-known-clean snapshot.
    await mergeFromServer(
      projectContract(400, { title: 'remote edit', description: 'orig' }),
    );

    const conflicts = await db.select<
      { entity_type: string; entity_local_id: string; fields: string }[]
    >(`SELECT entity_type, entity_local_id, fields FROM conflicts`);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.entity_type).toBe('project');
    expect(conflicts[0]!.entity_local_id).toBe(id);
    expect(JSON.parse(conflicts[0]!.fields)).toContain('title');
  });

  it('does not resurrect a pending-delete (dirty=1 && deleted=1)', async () => {
    // This is THE original recurring bug. A pull arrives for a row the
    // user has already locally deleted; we must not flip deleted back
    // to 0.
    const id = await mergeFromServer(
      projectContract(500, { title: 'about to delete' }),
    );
    const db = await getDb();
    await db.execute(
      `UPDATE projects SET dirty = 1, deleted = 1 WHERE local_id = ?`,
      [id],
    );

    // Pull comes in with the row still present on the server.
    await mergeFromServer(
      projectContract(500, { title: 'about to delete' }),
    );

    const [row] = await db.select<{ deleted: number; dirty: number }[]>(
      `SELECT deleted, dirty FROM projects WHERE local_id = ?`,
      [id],
    );
    expect(row!.deleted).toBe(1);
    expect(row!.dirty).toBe(1);
  });

  it('tolerates a garbled last_synced snapshot without throwing', async () => {
    const id = await mergeFromServer(
      projectContract(600, { title: 'baseline' }),
    );
    const db = await getDb();
    await db.execute(
      `UPDATE projects SET dirty = 1, last_synced = ? WHERE local_id = ?`,
      ['{not valid json', id],
    );

    // Should not throw, and should not record a conflict (we can't
    // reliably diff against a broken snapshot).
    await expect(
      mergeFromServer(projectContract(600, { title: 'remote-side update' })),
    ).resolves.toBe(id);

    const conflicts = await db.select<{ id: number }[]>(`SELECT id FROM conflicts`);
    expect(conflicts).toHaveLength(0);
  });

  it('respects a caller-supplied conflictFields list', async () => {
    const id = await mergeFromServer({
      ...projectContract(700, { title: 'same', description: 'orig' }),
      conflictFields: ['description'], // narrow scope: ignore title diffs
    });
    const db = await getDb();
    await db.execute(
      `UPDATE projects SET dirty = 1, title = 'local' WHERE local_id = ?`,
      [id],
    );

    // Remote diverged on title only — but conflictFields excludes it,
    // so no conflict row should be written.
    await mergeFromServer({
      ...projectContract(700, { title: 'remote', description: 'orig' }),
      conflictFields: ['description'],
    });

    const conflicts = await db.select<{ id: number }[]>(`SELECT id FROM conflicts`);
    expect(conflicts).toHaveLength(0);
  });
});
