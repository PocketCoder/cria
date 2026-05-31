/**
 * Coverage for src/db/relations.ts — the M8 sub-tasks / relations
 * mirror.
 *
 * What we pin:
 * 1. `replaceTaskRelationsFromServer` writes both locally-resolved
 *    peers and peers-by-server-id-only.
 * 2. It SKIPS the write when the owning task is dirty (the same
 *    pattern reminders use — prevents pull from resurrecting a row
 *    the user just removed locally before the push completes).
 * 3. `addRelation` inserts an optimistic local row AND queues an
 *    outbox op with the right payload + entity_type.
 * 4. `removeRelation` deletes the local row and queues a remove op
 *    that carries either the local or server peer id.
 */
import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { getDb } from '@/db';
import {
  replaceTaskRelationsFromServer,
  listRelationsForTask,
  addRelation,
  removeRelation,
} from '@/db/relations';
import { initSchema, clearTables, seedProject } from './_helpers';

async function seedTask(
  localId: string,
  serverId: number | null,
  projectLocalId: string,
  opts: { title?: string; done?: boolean; dirty?: boolean } = {},
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO tasks (
       local_id, server_id, project_local_id, title, done,
       priority, percent_done, is_favorite, is_subscribed,
       repeat_after, repeat_mode, updated_at, dirty, deleted
     ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, 0)`,
    [
      localId,
      serverId,
      projectLocalId,
      opts.title ?? localId,
      opts.done ? 1 : 0,
      new Date().toISOString(),
      opts.dirty ? 1 : 0,
    ],
  );
}

describe('replaceTaskRelationsFromServer', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  it('mirrors a locally-resolved peer', async () => {
    const proj = await seedProject(10, 'p');
    await seedTask('me', 1, proj);
    await seedTask('peer', 2, proj, { title: 'Buy milk', done: true });

    await replaceTaskRelationsFromServer('me', {
      subtask: [{ id: 2, title: 'Buy milk', done: true }],
    });

    const rels = await listRelationsForTask('me');
    expect(rels).toEqual([
      expect.objectContaining({
        kind: 'subtask',
        otherTaskLocalId: 'peer',
        otherTaskServerId: null,
        otherTaskTitle: 'Buy milk',
        otherTaskDone: true,
      }),
    ]);
  });

  it('carries a server-only peer when not yet synced locally', async () => {
    const proj = await seedProject(10, 'p');
    await seedTask('me', 1, proj);

    await replaceTaskRelationsFromServer('me', {
      related: [{ id: 99, title: 'Unsynced peer', done: false }],
    });

    const rels = await listRelationsForTask('me');
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({
      kind: 'related',
      otherTaskLocalId: null,
      otherTaskServerId: 99,
      // No local join → placeholder title.
      otherTaskTitle: '(not yet synced)',
    });
  });

  it('skips the mirror when the owning task is dirty', async () => {
    // Same race the reminders fix closed: the user removed a relation
    // locally and the outbox push hasn't drained yet. A pull landing
    // in that window must not re-insert the row.
    const proj = await seedProject(10, 'p');
    await seedTask('me', 1, proj, { dirty: true });
    await seedTask('peer', 2, proj);

    await replaceTaskRelationsFromServer('me', {
      subtask: [{ id: 2, title: 'peer' }],
    });

    const rels = await listRelationsForTask('me');
    expect(rels).toEqual([]);
  });

  it('replaces the set on each call', async () => {
    const proj = await seedProject(10, 'p');
    await seedTask('me', 1, proj);
    await seedTask('a', 2, proj, { title: 'A' });
    await seedTask('b', 3, proj, { title: 'B' });

    await replaceTaskRelationsFromServer('me', {
      subtask: [{ id: 2, title: 'A' }],
    });
    expect(await listRelationsForTask('me')).toHaveLength(1);

    await replaceTaskRelationsFromServer('me', {
      subtask: [{ id: 3, title: 'B' }],
    });
    const rels = await listRelationsForTask('me');
    expect(rels).toHaveLength(1);
    expect(rels[0]?.otherTaskTitle).toBe('B');
  });
});

describe('addRelation', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  it('inserts both forward and inverse rows, queues one add outbox op', async () => {
    const proj = await seedProject(10, 'p');
    await seedTask('me', 1, proj);
    await seedTask('peer', 2, proj, { title: 'My peer' });

    await addRelation('me', 'peer', 'subtask');

    // Forward direction
    const meRels = await listRelationsForTask('me');
    expect(meRels).toHaveLength(1);
    expect(meRels[0]).toMatchObject({
      kind: 'subtask',
      otherTaskLocalId: 'peer',
      otherTaskTitle: 'My peer',
    });

    // Inverse direction — peer should see the relation immediately
    const peerRels = await listRelationsForTask('peer');
    expect(peerRels).toHaveLength(1);
    expect(peerRels[0]).toMatchObject({
      kind: 'parenttask',
      otherTaskLocalId: 'me',
      otherTaskTitle: 'me',
    });

    const db = await getDb();
    const outbox = await db.select<
      { entity_type: string; entity_local_id: string; op: string; payload: string }[]
    >(`SELECT entity_type, entity_local_id, op, payload FROM outbox`);
    expect(outbox).toEqual([
      {
        entity_type: 'task_relation',
        entity_local_id: 'me',
        op: 'add',
        payload: JSON.stringify({ otherTaskLocalId: 'peer', kind: 'subtask' }),
      },
    ]);
  });
});

describe('removeRelation', () => {
  beforeAll(initSchema);
  beforeEach(clearTables);

  it('deletes both forward and inverse rows, queues a remove op', async () => {
    const proj = await seedProject(10, 'p');
    await seedTask('me', 1, proj);
    await seedTask('peer', 2, proj, { title: 'peer' });

    await addRelation('me', 'peer', 'subtask');
    // Verify both directions exist before the remove.
    expect(await listRelationsForTask('me')).toHaveLength(1);
    expect(await listRelationsForTask('peer')).toHaveLength(1);

    // Clear the add op so we only see the remove below.
    const db = await getDb();
    await db.execute(`DELETE FROM outbox`);

    await removeRelation('me', 'peer', null, 'subtask');

    // Both directions should be gone.
    expect(await listRelationsForTask('me')).toEqual([]);
    expect(await listRelationsForTask('peer')).toEqual([]);
    const outbox = await db.select<
      { entity_type: string; op: string; payload: string }[]
    >(`SELECT entity_type, op, payload FROM outbox`);
    expect(outbox).toEqual([
      {
        entity_type: 'task_relation',
        op: 'remove',
        payload: JSON.stringify({
          otherTaskLocalId: 'peer',
          otherTaskServerId: null,
          kind: 'subtask',
        }),
      },
    ]);
  });

  it('deletes a server-only-id row and queues the remove op accordingly', async () => {
    const proj = await seedProject(10, 'p');
    await seedTask('me', 1, proj);

    // Mirror a peer that hasn't synced locally.
    await replaceTaskRelationsFromServer('me', {
      related: [{ id: 99, title: 'far away' }],
    });
    expect(await listRelationsForTask('me')).toHaveLength(1);

    await removeRelation('me', null, 99, 'related');

    expect(await listRelationsForTask('me')).toEqual([]);
    const db = await getDb();
    const outbox = await db.select<{ op: string; payload: string }[]>(
      `SELECT op, payload FROM outbox`,
    );
    expect(outbox).toEqual([
      {
        op: 'remove',
        payload: JSON.stringify({
          otherTaskLocalId: null,
          otherTaskServerId: 99,
          kind: 'related',
        }),
      },
    ]);
  });
});
