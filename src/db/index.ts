/**
 * SQLite handle. Two backends:
 * - Tauri renderer → `@tauri-apps/plugin-sql` (real app)
 * - Node test runner → `better-sqlite3` wrapped to match the same shape
 *
 * Both satisfy the `Database` interface below, which is the subset of the
 * Tauri plugin's API the rest of the codebase actually uses. Keep this
 * surface narrow — anything callsites need, add a typed method here, don't
 * widen to `any`.
 */

export const DB_URI = 'sqlite:cria.db';

export interface ExecuteResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface Database {
  execute(sql: string, params?: unknown[]): Promise<ExecuteResult>;
  select<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
  close?(): Promise<boolean>;
}

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = loadDb().catch((err) => {
      dbPromise = null; // allow retry after a failed open
      throw err;
    });
  }
  return dbPromise;
}

async function loadDb(): Promise<Database> {
  if (typeof window !== 'undefined') {
    // Tauri webview path. The plugin's `Database` class satisfies our
    // interface (its execute/select shapes match).
    const mod = await import('@tauri-apps/plugin-sql');
    const Sqlite = (mod as { default: { load(uri: string): Promise<Database> } }).default;
    return Sqlite.load(DB_URI);
  }
  return loadNodeDb();
}

async function loadNodeDb(): Promise<Database> {
  // @ts-expect-error — no @types/better-sqlite3 installed; we type-narrow at the cast below.
  const mod = await import('better-sqlite3');
  const BetterSqlite = (mod as unknown as { default: new (path: string) => NodeSqlite }).default;
  const filename = DB_URI.replace(/^sqlite:/, '') || ':memory:';
  // In tests we always want a fresh, in-memory DB to avoid bleed between runs.
  const db = new BetterSqlite(process.env.VITEST ? ':memory:' : filename);

  return {
    async execute(sql, params) {
      // better-sqlite3 only supports parameterised single statements; for
      // multi-statement scripts (e.g. our schema migration) we route through
      // exec() and lose the rowsAffected info, which the caller doesn't use
      // in that path.
      if (sql.trim().includes(';\n') || sql.includes('CREATE TABLE')) {
        db.exec(sql);
        return { rowsAffected: 0 };
      }
      const stmt = db.prepare(sql);
      const info = stmt.run(...((params ?? []) as unknown[]));
      return {
        rowsAffected: Number(info.changes),
        lastInsertId: Number(info.lastInsertRowid),
      };
    },
    async select<T>(sql: string, params?: unknown[]): Promise<T> {
      const stmt = db.prepare(sql);
      return stmt.all(...((params ?? []) as unknown[])) as unknown as T;
    },
  };
}

// Minimal type for the better-sqlite3 instance methods we use.
interface NodeSqlite {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
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
