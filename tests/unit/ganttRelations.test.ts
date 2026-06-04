// DB test for the Gantt dependency-edge query: only canonical
// blocking/precedes kinds, scoped to the project, in source→target order.

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { getDb } from '@/db';
import { initSchema, clearTables, seedProject } from './_helpers';
import { addRelation, listGanttRelationsForProject } from '@/db/relations';

const NOW = '2024-01-01T00:00:00Z';

async function seedTask(localId: string, projectLocalId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO tasks (local_id, server_id, project_local_id, title, updated_at, dirty, deleted)
     VALUES (?, NULL, ?, ?, ?, 0, 0)`,
    [localId, projectLocalId, localId, NOW],
  );
}

describe('listGanttRelationsForProject', () => {
  beforeAll(async () => {
    await initSchema();
  });
  beforeEach(async () => {
    await clearTables();
  });

  it('returns a blocking edge in canonical direction, excluding the stored inverse', async () => {
    const proj = await seedProject(1);
    await seedTask('a', proj);
    await seedTask('b', proj);
    // addRelation stores a→b 'blocking' AND the inverse b→a 'blocked'.
    await addRelation('a', 'b', 'blocking');

    const edges = await listGanttRelationsForProject(proj);
    expect(edges).toEqual([{ fromLocalId: 'a', toLocalId: 'b', kind: 'blocking' }]);
  });

  it('includes precedes and excludes edges sourced from another project', async () => {
    const proj = await seedProject(2);
    const other = await seedProject(3);
    await seedTask('x', proj);
    await seedTask('y', proj);
    await seedTask('z', other);

    await addRelation('x', 'y', 'precedes'); // in-project
    await addRelation('z', 'x', 'blocking'); // source 'z' lives in `other`

    const edges = await listGanttRelationsForProject(proj);
    expect(edges).toEqual([{ fromLocalId: 'x', toLocalId: 'y', kind: 'precedes' }]);
  });
});
