let Database: any;
// Lazy import to support both Tauri (browser) and Node (test) environments.
// The actual module is loaded inside `getDb()` to avoid the `require`
// ReferenceError that occurs in ESM contexts.
export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    if (typeof window !== 'undefined') {
      // Tauri renderer – load the official plugin.
      const { default: Sqlite } = await import('@tauri-apps/plugin-sql');
      Database = Sqlite;
    } else {
      // Node test environment – load better‑sqlite3 and wrap it.
      const { default: DatabaseNode } = await import('better-sqlite3');
      class NodeDatabase {
        private db: any;
        constructor(uri: string) {
          const filename = uri.replace(/^sqlite:/, '');
          this.db = new DatabaseNode(filename || ':memory:');
        }
        async execute(sql: string, params?: any[]) {
          if (params && params.length) {
            const stmt = this.db.prepare(sql);
            stmt.run(...params);
          } else {
            this.db.exec(sql);
          }
        }
        async select<T>(sql: string, params?: any[]): Promise<T[]> {
          const stmt = this.db.prepare(sql);
          const rows = stmt.all(...(params ?? []));
          return rows as T[];
        }
        static async load(uri: string) {
          return new NodeDatabase(uri);
        }
      }
      Database = NodeDatabase;
    }
    dbPromise = Database.load(DB_URI);
  }
  return dbPromise;
}


export const DB_URI = 'sqlite:cria.db';

let dbPromise: Promise<Database> | null = null;

/* getDb is defined above with dynamic imports */

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

export type Database = any;
