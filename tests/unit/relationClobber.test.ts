// #87: a server pull must not wipe relations the user added/removed locally
// but hasn't pushed yet (incl. the auto-created inverse on the peer task).

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import {
  addRelation,
  removeRelation,
  replaceTaskRelationsFromServer,
  listRelationsForTask,
} from '@/db/relations';

const NOW = '2024-01-01T00:00:00Z';

async function seedTask(localId: string, serverId: number, projectLocalId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO tasks (local_id, server_id, project_local_id, title, updated_at, dirty, deleted)
     VALUES (?, ?, ?, ?, ?, 0, 0)`,
    [localId, serverId, projectLocalId, localId, NOW],
  );
}

const keys = (rels: { kind: string; otherTaskLocalId: string | null }[]) =>
  rels.map((r) => `${r.kind}:${r.otherTaskLocalId}`);

describe('relation pull clobber guard (#87)', () => {
  beforeAll(async () => {
    await initSchema();
  });
  beforeEach(async () => {
    await clearTables();
  });

  it('preserves an optimistic relation and its inverse when the pull omits it', async () => {
    const proj = await seedProject(1);
    await seedTask('A', 10, proj);
    await seedTask('B', 11, proj);
    await addRelation('A', 'B', 'blocking'); // A blocking→B, B blocked→A, push queued

    // Pull of B (push hasn't landed → server returns no relations for B).
    await replaceTaskRelationsFromServer('B', {});
    expect(keys(await listRelationsForTask('B'))).toContain('blocked:A');

    // Pull of A likewise.
    await replaceTaskRelationsFromServer('A', {});
    expect(keys(await listRelationsForTask('A'))).toContain('blocking:B');
  });

  it('still applies server relations that are not pending', async () => {
    const proj = await seedProject(2);
    await seedTask('A', 20, proj);
    await seedTask('C', 22, proj);
    // No local op; the server reports A related→C → it should be inserted.
    await replaceTaskRelationsFromServer('A', { related: [{ id: 22 }] } as never);
    expect(keys(await listRelationsForTask('A'))).toEqual(['related:C']);
  });

  it('does not re-add a relation removed locally but not yet pushed', async () => {
    const proj = await seedProject(3);
    await seedTask('A', 30, proj);
    await seedTask('B', 31, proj);
    await addRelation('A', 'B', 'blocking');
    await removeRelation('A', 'B', null, 'blocking'); // queues remove; rows deleted

    // Server still has it (remove hasn't pushed) — pull must NOT resurrect it.
    await replaceTaskRelationsFromServer('A', { blocking: [{ id: 31 }] } as never);
    const a = await listRelationsForTask('A');
    expect(a.some((r) => r.kind === 'blocking' && r.otherTaskLocalId === 'B')).toBe(false);
  });
});
