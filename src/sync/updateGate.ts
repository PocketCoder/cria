import { getDb } from '@/db';
import { drainOutbox } from './push';

/** Shown when an update is held back because edits are still waiting to reach the server. */
export const UNSYNCED_MESSAGE = 'Sync your changes before updating. Check your connection and try again.';
/** Dead letters never clear by themselves, so retrying the update will not help until they are dealt with. */
export const DEAD_LETTER_MESSAGE =
  'Some changes could not be synced. Use the sync status at the bottom of the sidebar to retry or discard them, then update.';

export interface UnsyncedCounts {
  /** Edits still queued to go to the server. */
  pending: number;
  /** Edits the server rejected for good; they need a person to retry or discard them. */
  deadLetters: number;
}

export async function countUnsyncedChanges(): Promise<UnsyncedCounts> {
  const db = await getDb();
  const [row] = await db.select<{ pending: number; dead: number }[]>(
    `SELECT (SELECT COUNT(*) FROM outbox) AS pending, (SELECT COUNT(*) FROM outbox_dead_letter) AS dead`,
    [],
  );
  return { pending: row?.pending ?? 0, deadLetters: row?.dead ?? 0 };
}

/** `drainOutbox` returns at once when a drain is already running, so wait for that one to finish first. */
async function waitForRunningDrain(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (globalThis.__cria_isDraining__ && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export type GateResult =
  | { ok: true }
  | { ok: false; pending: number; deadLetters: number; message: string };

/**
 * The native Mac app starts from a fresh database and re-syncs from the server, so an update must not install
 * while this app still holds edits the server has not seen. Drains the outbox, then counts what is left.
 */
export async function syncBeforeUpdate(): Promise<GateResult> {
  try {
    await waitForRunningDrain(15_000);
    await drainOutbox();
  } catch (err) {
    console.warn('[updater] drain before update failed:', err);
  }
  const { pending, deadLetters } = await countUnsyncedChanges();
  if (pending === 0 && deadLetters === 0) return { ok: true };
  return {
    ok: false,
    pending,
    deadLetters,
    message: pending === 0 ? DEAD_LETTER_MESSAGE : UNSYNCED_MESSAGE,
  };
}
