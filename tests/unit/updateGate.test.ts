// The updater must not install while local edits are unsynced: the native Mac app starts from a fresh database.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { drainOutbox } = vi.hoisted(() => ({ drainOutbox: vi.fn() }));
vi.mock('@/sync/push', () => ({ drainOutbox }));

import { getDb } from '@/db';
import { initSchema, clearTables } from './_helpers';
import { countUnsyncedChanges, DEAD_LETTER_MESSAGE, syncBeforeUpdate } from '@/sync/updateGate';

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
    expect(await syncBeforeUpdate()).toMatchObject({ ok: false, pending: 1, deadLetters: 0 });
  });

  it('counts dead letters as unsynced', async () => {
    await insertOutbox();
    await insertDeadLetter();
    expect(await countUnsyncedChanges()).toEqual({ pending: 1, deadLetters: 1 });
    expect(await syncBeforeUpdate()).toMatchObject({ ok: false, pending: 1, deadLetters: 1 });
  });

  it('still counts what is left when the drain itself throws', async () => {
    await insertOutbox();
    drainOutbox.mockRejectedValue(new Error('offline'));
    expect(await syncBeforeUpdate()).toMatchObject({ ok: false, pending: 1 });
  });

  it('points at Settings when only dead letters remain', async () => {
    await insertDeadLetter();
    const gate = await syncBeforeUpdate();
    expect(gate).toMatchObject({ ok: false, pending: 0, deadLetters: 1 });
    expect(gate.ok === false && gate.message).toBe(DEAD_LETTER_MESSAGE);
  });

  it('waits for a drain that is already running', async () => {
    globalThis.__cria_isDraining__ = true;
    setTimeout(() => {
      globalThis.__cria_isDraining__ = false;
    }, 300);
    await syncBeforeUpdate();
    expect(globalThis.__cria_isDraining__).toBe(false);
    expect(drainOutbox).toHaveBeenCalledTimes(1);
  });
});
