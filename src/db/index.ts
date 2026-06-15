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
 * Global write serialisation.
 *
 * SQLite permits only one transaction per connection at a time; the Tauri
 * SQL plugin shares one connection. Two writes that overlap collide on
 * BEGIN ("cannot start a transaction within a transaction") or fail with
 * "database is locked". We queue every write onto a single promise chain
 * so each one starts only after the previous finishes.
 *
 * **Why globalThis.** Vite HMR reloads `src/db/index.ts` (e.g. when any
 * sibling file in this folder changes), which would otherwise reset the
 * module-level `writeChain` to `Promise.resolve()` while old in-flight
 * transactions are still active on the connection. Pinning the chain to
 * `globalThis` lets the new module observe the in-flight tail and wait
 * for it instead of starting a fresh BEGIN that collides.
 */
declare global {
  // eslint-disable-next-line no-var
  var __cria_writeChain__: Promise<unknown> | undefined;
}

function chainHead(): Promise<unknown> {
  return (globalThis.__cria_writeChain__ ??= Promise.resolve());
}

function setChainHead(p: Promise<unknown>): void {
  globalThis.__cria_writeChain__ = p;
}

/**
 * Queue `fn` onto the global write chain. Use for any write that must not
 * overlap with another (transactional or single-statement). Rejections do
 * not poison subsequent queue entries.
 */
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chainHead().then(fn);
  setChainHead(next.catch(() => undefined));
  return next as Promise<T>;
}

/**
 * Run a function with multi-statement transactional atomicity.
 *
 * The callback receives a `db`-shaped object whose `execute(sql, params)`
 * calls *do not run immediately* — they collect into a batch. Once the
 * callback resolves, the batch is sent to a Rust-side custom command
 * (`plugin:cria|execute_tx`) which acquires one pinned sqlx connection,
 * runs everything inside a real `sqlx::Transaction`, and commits.
 *
 * Why this contortion: `@tauri-apps/plugin-sql` v2.4 wraps `Pool<Sqlite>`
 * (10 conns by default), so each JS-issued `db.execute()` acquires a
 * fresh connection — making JS-side `BEGIN`/`COMMIT` useless (BEGIN on
 * conn A → released holding a tx → COMMIT on conn E sees "no transaction
 * is active"). See src-tauri/src/tx.rs for the Rust side.
 *
 * Constraints on the callback:
 * - `db.execute()` returns a placeholder ExecuteResult (rowsAffected: 0,
 *   lastInsertId: 0). Use SELECT to read state *before* opening withTx,
 *   not between collected writes inside.
 * - `db.select()` still goes straight to plugin-sql (reads don't need the
 *   pinned connection). Under serial() no concurrent write interleaves.
 */
export function withTx<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  return serial(async () => {
    const real = await getDb();
    const stmts: Array<{ sql: string; params: unknown[] }> = [];
    const scope: Database = {
      async execute(sql, params) {
        stmts.push({ sql, params: params ?? [] });
        return { rowsAffected: 0, lastInsertId: 0 };
      },
      async select<R>(sql: string, params?: unknown[]) {
        return real.select<R>(sql, params);
      },
    };
    const result = await fn(scope);
    if (stmts.length > 0) await runTx(stmts);
    return result;
  });
}

async function runTx(
  stmts: Array<{ sql: string; params: unknown[] }>,
): Promise<void> {
  // Node test path: wrap the batch in an explicit transaction so a failure
  // mid-batch rolls back, matching the atomic Rust `execute_tx` path. Without
  // BEGIN/COMMIT each statement auto-commits on its own and a partial-batch
  // bug would silently pass in tests while corrupting state in production.
  if (typeof window === 'undefined') {
    const db = await getDb();
    await db.execute('BEGIN');
    try {
      for (const s of stmts) await db.execute(s.sql, s.params);
      await db.execute('COMMIT');
    } catch (e) {
      try {
        await db.execute('ROLLBACK');
      } catch {
        // ignore rollback failure; surface the original error
      }
      throw e;
    }
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  // Command lives directly on the app via invoke_handler! in lib.rs —
  // not behind a `plugin:cria|…` prefix.
  await invoke('execute_tx', { db: DB_URI, stmts });
}

/**
 * Execute a single write statement, queued behind any in-flight
 * transactions. Use whenever you'd otherwise call `db.execute(sql, params)`
 * for a write (INSERT / UPDATE / DELETE). Reads (`db.select`) do not need
 * this — they don't take the write lock.
 */
export async function exec(
  sql: string,
  params?: unknown[],
): Promise<ExecuteResult> {
  return serial(async () => {
    const db = await getDb();
    return db.execute(sql, params);
  });
}

/**
 * Ensure an async function is only called once at a time for a given key.
 * Subsequent calls while one is in-flight return the same promise.
 */
const inflight = new Map<string, Promise<unknown>>();
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}
