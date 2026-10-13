import { getDb } from '@/db';
import { drainOutbox } from './push';

/** Shown when an update is held back because local edits have not reached the server. */
export const UNSYNCED_MESSAGE = 'Sync your changes before updating. Check your connection and try again.';

/** Outbox rows plus dead letters: everything a new app could not recover from this app's database. */
export async function countUnsyncedChanges(): Promise<number> {
  const db = await getDb();
  const [row] = await db.select<{ n: number }[]>(
    `SELECT (SELECT COUNT(*) FROM outbox) + (SELECT COUNT(*) FROM outbox_dead_letter) AS n`,
    [],
  );
  return row?.n ?? 0;
}

/**
 * The native Mac app starts from a fresh database and re-syncs from the server, so an update must not install
 * while this app still holds edits the server has not seen. Drains the outbox, then counts what is left.
 */
export async function syncBeforeUpdate(): Promise<{ ok: true } | { ok: false; pending: number }> {
  try {
    await drainOutbox();
  } catch (err) {
    console.warn('[updater] drain before update failed:', err);
  }
  const pending = await countUnsyncedChanges();
  return pending === 0 ? { ok: true } : { ok: false, pending };
}
