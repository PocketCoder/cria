// Shared Tauri/native mocks for UI smoke tests.
//
// Import this file FIRST in every `tests/ui/*.test.tsx` (before any `@/`
// import) so the `vi.mock` calls below are registered before the app modules
// resolve their Tauri dependencies. It also registers the jest-dom matchers
// and unmounts rendered trees after each test.
//
// Strategy: mock the Tauri boundary, keep everything else real. The SQL
// plugin is replaced by an in-memory better-sqlite3 database (same trick
// `src/db/index.ts` uses for the node runner, which is not taken under jsdom
// because `window` exists), so repositories, migrations, the change bus and
// TanStack Query all run for real.

import { createRequire } from 'node:module';
import { afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';

interface NodeStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  all(...params: unknown[]): unknown[];
}
interface NodeSqlite {
  prepare(sql: string): NodeStatement;
  exec(sql: string): void;
}

const require = createRequire(import.meta.url);
const BetterSqlite = require('better-sqlite3') as new (path: string) => NodeSqlite;

/** The single in-memory database shared by the mocked SQL plugin and `execute_tx`. */
export const sqlite: NodeSqlite = new BetterSqlite(':memory:');

const sqlPlugin = {
  async execute(sql: string, params: unknown[] = []) {
    if (sql.trim().includes(';\n') || sql.includes('CREATE TABLE')) {
      sqlite.exec(sql);
      return { rowsAffected: 0 };
    }
    const info = sqlite.prepare(sql).run(...params);
    return { rowsAffected: Number(info.changes), lastInsertId: Number(info.lastInsertRowid) };
  },
  async select<T>(sql: string, params: unknown[] = []): Promise<T> {
    return sqlite.prepare(sql).all(...params) as unknown as T;
  },
};

/** Stand-in for the Rust `execute_tx` command: one atomic batch. */
function executeTx(args: unknown): void {
  const { stmts } = args as { stmts: Array<{ sql: string; params: unknown[] }> };
  sqlite.exec('BEGIN');
  try {
    for (const s of stmts) sqlite.prepare(s.sql).run(...s.params);
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
}

/** Every `invoke()` call made by the app under test, for assertions. */
export const invokeCalls: Array<{ cmd: string; args: unknown }> = [];

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => sqlPlugin },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: unknown) => {
    invokeCalls.push({ cmd, args });
    if (cmd === 'execute_tx') return executeTx(args);
    return null;
  },
  isTauri: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'macos',
  type: () => 'macos',
}));

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: async () => true,
  requestPermission: async () => 'granted',
  sendNotification: () => undefined,
  pending: async () => [],
  cancel: async () => undefined,
  registerActionTypes: async () => undefined,
  onAction: async () => ({ unregister: async () => undefined }),
  Schedule: { at: (date: Date) => ({ at: { date } }) },
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: async () => undefined,
  openPath: async () => undefined,
  revealItemInDir: async () => undefined,
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: async () => null,
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: async () => undefined,
  exit: async () => undefined,
}));

vi.mock('@tauri-apps/plugin-autostart', () => ({
  enable: async () => undefined,
  disable: async () => undefined,
  isEnabled: async () => false,
}));

vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: async () => undefined,
  unregister: async () => undefined,
  unregisterAll: async () => undefined,
  isRegistered: async () => false,
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: async () => '0.0.0-test',
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: async () => () => undefined,
  emit: async () => undefined,
}));

vi.mock('@tauri-apps/api/window', () => {
  const win = {
    setBadgeCount: async () => undefined,
    show: async () => undefined,
    hide: async () => undefined,
    setFocus: async () => undefined,
    onCloseRequested: async () => () => undefined,
    onFocusChanged: async () => () => undefined,
    isVisible: async () => true,
  };
  return { getCurrentWindow: () => win };
});

// Network: nothing real is reachable. `/user` gets a minimal profile; every
// other request gets an empty 200 list. The UI renders from the local DB.
export function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const isUser = /\/api\/v1\/user$/.test(url);
      const body = isUser
        ? { id: 1, username: 'tester', name: 'Tester', email: 'tester@example.test', settings: {} }
        : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-pagination-total-pages': '1' },
      });
    }),
  );
}

// jsdom gaps the UI relies on.
function installDomPolyfills(): void {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  class NoopObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  }
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= NoopObserver;
  g.IntersectionObserver ??= NoopObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
}

// The task inspector's SubtasksBlock re-runs an effect on every render (its
// `subtasks` dependency is a fresh array each time and the effect sets state),
// so it never settles. `act()` flushes effects until the queue is empty and
// would therefore never return; dispatch events without it and let React's
// scheduler interleave the loop with the test's own awaits instead.
configure({ eventWrapper: (cb) => cb() });

installDomPolyfills();
stubFetch();

afterEach(() => {
  cleanup();
});
