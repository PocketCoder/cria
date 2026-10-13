// The updater must not install while local edits are unsynced: the native Mac app starts from a fresh database.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { drainOutbox } = vi.hoisted(() => ({ drainOutbox: vi.fn() }));
vi.mock('@/sync/push', () => ({ drainOutbox }));

import { getDb } from '@/db';
import { initSchema, clearTables } from './_helpers';
import { countUnsyncedChanges, syncBeforeUpdate } from '@/sync/updateGate';

async function insertOutbox() {
  const db = await getDb();
  await db.execute(
    `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
     VALUES ('task', 't1', 'update', '{}', '2026-10-01T00:00:00Z')`,
    [],
  );
}

async function insertDeadLetter() {
  const db = await getDb();
  await db.execute(
    `INSERT INTO outbox_dead_letter (entity_type, entity_local_id, op, payload, attempts, failed_at)
     VALUES ('task', 't2', 'update', '{}', 5, '2026-10-01T00:00:00Z')`,
    [],
  );
}

describe('syncBeforeUpdate', () => {
  beforeAll(async () => {
    await initSchema();
  });

  beforeEach(async () => {
    await clearTables();
    drainOutbox.mockReset();
    drainOutbox.mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('allows the update when nothing is pending after the drain', async () => {
    expect(await syncBeforeUpdate()).toEqual({ ok: true });
    expect(drainOutbox).toHaveBeenCalledTimes(1);
  });

  it('holds the update back while an outbox row remains', async () => {
    await insertOutbox();
    expect(await syncBeforeUpdate()).toEqual({ ok: false, pending: 1 });
  });

  it('counts dead letters as unsynced', async () => {
    await insertOutbox();
    await insertDeadLetter();
    expect(await countUnsyncedChanges()).toBe(2);
    expect(await syncBeforeUpdate()).toEqual({ ok: false, pending: 2 });
  });

  it('still counts what is left when the drain itself throws', async () => {
    await insertOutbox();
    drainOutbox.mockRejectedValue(new Error('offline'));
    expect(await syncBeforeUpdate()).toEqual({ ok: false, pending: 1 });
  });
});
