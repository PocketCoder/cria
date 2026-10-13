// Soak-test harness: runs the Vite frontend in Chromium with Tauri IPC mocked.
// SQL goes to an in-memory better-sqlite3 DB in Node (migrations + seed data);
// HTTP fails (offline), so the app runs purely off the local DB.
// Method: https://denodell.com/blog/your-spa-is-leaking-memory-soak-test-it
import { execFileSync, spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';

const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = 5199;

export function makeDb() {
  const db = new Database(':memory:');
  const dir = join(ROOT, 'src/db/migrations');
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO user (id, server_id, username, name, raw, fetched_at)
    VALUES (1, 1, 'soak', 'Soak', ?, ?)`).run(JSON.stringify({ id: 1, username: 'soak', settings: {} }), now);
  const p = db.prepare(`INSERT INTO projects (local_id, server_id, title, position, updated_at) VALUES (?, ?, ?, ?, ?)`);
  const t = db.prepare(`INSERT INTO tasks (local_id, server_id, project_local_id, title, description, priority, due_date, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let sid = 1;
  for (let i = 0; i < 4; i++) {
    p.run(`p${i}`, 100 + i, `Project ${i}`, i, now);
    for (let j = 0; j < 40; j++) {
      const due = j % 3 === 0 ? new Date(Date.now() + (j - 10) * 86400e3).toISOString() : null;
      t.run(`t${i}-${j}`, sid++, `p${i}`, `Task ${i}.${j}`, `<p>Body ${j}</p>`, j % 5, due, j, now, now);
    }
  }
  return db;
}

const bind = (v) => (typeof v === 'boolean' ? Number(v) : v && typeof v === 'object' ? JSON.stringify(v) : v);

function ipc(db, cmd, args = {}) {
  switch (cmd) {
    case 'plugin:sql|load': return args.db;
    case 'plugin:sql|select': return db.prepare(args.query).all(...(args.values ?? []).map(bind));
    case 'plugin:sql|execute': {
      const r = db.prepare(args.query).run(...(args.values ?? []).map(bind));
      return [r.changes, Number(r.lastInsertRowid)];
    }
    case 'execute_tx':
      return db.transaction(() => args.stmts.map((s) => {
        const r = db.prepare(s.sql).run(...s.params.map(bind));
        return { rowsAffected: r.changes, lastInsertId: Number(r.lastInsertRowid) };
      }))();
    case 'secure_get_token':
      return JSON.stringify({ serverUrl: 'https://vikunja.invalid', token: 'soak', authMethod: 'token' });
    default:
      if (cmd.startsWith('plugin:http|')) throw new Error('offline (soak harness)');
      return null; // events, notifications, tray, etc.
  }
}

// Soaks the production build (`vite build` first); dev mode adds StrictMode
// double effects and HMR state that would muddy the numbers.
export async function startVite() {
  execFileSync(join(ROOT, 'node_modules/.bin/vite'), ['build'], { cwd: ROOT, stdio: 'ignore' });
  const proc = spawn(join(ROOT, 'node_modules/.bin/vite'), ['preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT });
  await new Promise((res, rej) => {
    proc.stdout.on('data', (d) => String(d).includes('Local:') && res());
    proc.on('exit', (c) => rej(new Error(`vite exited ${c}`)));
  });
  return { url: `http://localhost:${PORT}/`, stop: () => proc.kill() };
}

export async function openApp(url) {
  const browser = await chromium.launch({ channel: process.env.SOAK_CHANNEL ?? 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const db = makeDb();
  await page.exposeFunction('__soakIpc', (cmd, args) => ipc(db, cmd, args));
  await page.addInitScript(() => {
    let cb = 0;
    window.__TAURI_INTERNALS__ = {
      invoke: (cmd, args) => window.__soakIpc(cmd, args),
      transformCallback: () => ++cb,
      unregisterCallback: () => {},
      convertFileSrc: (p) => p,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
  if (process.env.SOAK_DEBUG) {
    page.on('response', (r) => { if (r.status() >= 400) console.error('[http]', r.status(), r.url()); });
    page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text().slice(0, 300)); });
  }
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(url);
  return { browser, page, db };
}
