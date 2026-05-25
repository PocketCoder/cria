import Database from '@tauri-apps/plugin-sql';

export const DB_URI = 'sqlite:cria.db';

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URI);
  }
  return dbPromise;
}

/**
 * Run a function inside a SQLite transaction. Rolls back on any thrown error
 * and rethrows. The Tauri SQL plugin doesn't expose transaction objects, so
 * we issue BEGIN / COMMIT / ROLLBACK manually.
 */
export async function withTx<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const db = await getDb();
  await db.execute('BEGIN');
  try {
    const result = await fn(db);
    await db.execute('COMMIT');
    return result;
  } catch (err) {
    try {
      await db.execute('ROLLBACK');
    } catch {
      // ignore — failure to roll back means the transaction is already dead
    }
    throw err;
  }
}

export type { Database };
