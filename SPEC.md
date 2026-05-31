# Vikunja Desktop Client — Technical Specification

A polished, offline-capable, cross-platform desktop client for [Vikunja](https://vikunja.io), built with Tauri 2 and TypeScript.

**Codename:** `Cria`.

---

## 1. Goals & Non-Goals

### Goals

- **Native feel.** Window chrome, keyboard handling, drag-and-drop, context menus, OS notifications, tray, global shortcuts — all the things a wrapped webapp gets wrong.
- **Offline-first.** Every read hits a local SQLite database. Every write goes to a local outbox and is replayed against the server when online. The app never blocks on the network for UI interactions.
- **Sync is invisible when it works, transparent when it doesn't.** No spinners on common actions. Clear UI for conflicts and queued operations.
- **Small footprint.** Target <15 MB installed, <80 MB RAM idle.
- **Cross-platform.** macOS (Apple Silicon + Intel), Windows, Linux. Same codebase, native installers.
- **Self-host friendly.** Configurable server URL, handles CORS gracefully, no Vikunja Cloud assumptions baked in.

### Non-goals (v1)

- Mobile (Tauri 2 supports it, but defer)
- Real-time multi-user collaboration via WebSocket (Vikunja doesn't expose one)
- Built-in server-side hosting
- Custom plugin/extension API
- Migration tooling from other task apps (Vikunja's own importer covers this)

---

## 2. Stack Decision

| Concern | Choice | Why |
|---|---|---|
| Shell | **Tauri 2.x** | Native webview, ~10 MB bundles, sandboxed, mobile-ready later |
| UI framework | **React 18** + TypeScript | Largest ecosystem, best Tauri plugin docs, easiest hiring |
| Bundler | **Vite** | Tauri's default, fast HMR |
| Router | **TanStack Router** | Type-safe routes, built-in search params, integrates with TanStack Query |
| Server-state cache | **TanStack Query** | Battle-tested, optimistic updates, retry/refetch logic for free |
| Client state | **Zustand** | Tiny, no boilerplate, works great alongside TanStack Query |
| Local DB | **`@tauri-apps/plugin-sql`** (SQLite) | Real ACID, real SQL, integrates cleanly with sync engine |
| Validation | **Zod** | Runtime checking of server payloads + form schemas |
| API client | **`openapi-fetch`** + types from **`openapi-typescript`** | Generated from Vikunja's own spec, fully typed |
| Styling | **Tailwind CSS v4** | Pairs well with shadcn/ui components |
| Component primitives | **Radix UI** via **shadcn/ui** | Accessible, unstyled, copy-paste — no lock-in |
| Date handling | **date-fns** + **date-fns-tz** | Sane, tree-shakeable |
| Drag & drop | **dnd-kit** | Accessible, performant, works with virtualized lists |
| Virtualization | **TanStack Virtual** | For long task lists / kanban columns |
| Forms | **react-hook-form** + Zod resolver | Standard, ergonomic |
| Testing | **Vitest** (unit) + **Playwright** (e2e) | Vite-native, fast |

### Why not Electron?

Electron is fine and Vikunja's official app already uses it. But Tauri wins on every metric that matters to a polished desktop app: smaller, faster, less memory, system webview means OS-level features (autofill, accessibility, spellcheck) Just Work. The Rust shell is invisible unless you need it.

### Why not pure web (PWA)?

Vikunja's frontend already is one. The point of building this is OS integration — tray, global shortcuts, native notifications, file system access, autolaunch, Spotlight/Alfred deep links. PWAs can't do most of that on macOS or Windows.

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Tauri Webview                              │
│                                                                      │
│   ┌──────────────┐    ┌────────────────┐    ┌─────────────────┐      │
│   │  UI (React)  │───▶│  Query Layer   │───▶│  Local DB       │      │
│   │              │    │  (TanStack Q)  │    │  (SQLite via    │      │
│   │              │◀───│                │◀───│   plugin-sql)   │      │
│   └──────────────┘    └────────────────┘    └────────┬────────┘      │
│         │                                            │               │
│         ▼                                            ▼               │
│   ┌──────────────┐                          ┌─────────────────┐      │
│   │  Zustand     │                          │  Sync Engine    │      │
│   │  (UI state)  │                          │  (Worker)       │      │
│   └──────────────┘                          └────────┬────────┘      │
│                                                      │               │
└──────────────────────────────────────────────────────┼───────────────┘
                                                       │
                                                       ▼
                                            ┌─────────────────────┐
                                            │  Vikunja REST API   │
                                            │  (/api/v1)          │
                                            └─────────────────────┘
```

**Key principle:** UI reads only from the local DB via the query layer. The sync engine is the *only* component that talks to Vikunja's API. Writes go to the DB first, then enqueued in an outbox table for the sync engine to drain.

This separation means:
- The UI is always instant and works offline trivially.
- Sync logic is centralized and testable in isolation.
- Network failures never bubble up as UI errors mid-interaction.

---

## 4. Data Model

### 4.1 Vikunja entities we care about (v1)

| Entity | Notes |
|---|---|
| **User** | The logged-in user. Single row. |
| **Project** | Top-level container (formerly "list"). Tree-structured via `parent_project_id`. |
| **Task** | The main unit of work. Has many: labels, assignees, attachments, reminders, comments, relations. |
| **Label** | Reusable tags applied to tasks. |
| **Team** | For sharing/permissions. Read-only in v1. |
| **Filter** | Saved query (uses Vikunja's filter expression language). |
| **View** | Per-project saved views (list/kanban/gantt/table). |
| **Notification** | Bell-icon items. Read-only, polled. |

Out of scope for v1: webhooks, migration, custom backgrounds.

### 4.2 Local schema

We mirror Vikunja's model but add four sync-related columns to every syncable entity:

```sql
CREATE TABLE projects (
  -- Identity
  local_id        TEXT PRIMARY KEY,        -- UUID v4, generated locally
  server_id       INTEGER UNIQUE,          -- NULL until first successful sync

  -- Vikunja fields (subset; see openapi-types.ts for the full set)
  title           TEXT NOT NULL,
  description     TEXT,
  parent_local_id TEXT REFERENCES projects(local_id),
  hex_color       TEXT,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  position        REAL,

  -- Sync metadata
  updated_at      TEXT NOT NULL,           -- ISO 8601, server time when known
  synced_at       TEXT,                    -- last successful round-trip
  dirty           INTEGER NOT NULL DEFAULT 0,  -- 1 if local changes pending
  deleted         INTEGER NOT NULL DEFAULT 0   -- soft delete; tombstones drained by sync
);

CREATE INDEX idx_projects_parent ON projects(parent_local_id);
CREATE INDEX idx_projects_dirty ON projects(dirty) WHERE dirty = 1;
```

Same pattern for `tasks`, `labels`, `task_labels`, `task_assignees`, etc.

**Why local UUIDs?** Two reasons:

1. The user can create entities offline, before the server assigns an ID.
2. Foreign-key references stay stable across sync. A task created offline that references an offline-created project doesn't need an ID rewrite when both eventually sync.

`server_id` is `NULL` until the entity has been created on the server. Once we get a server ID back, we store it and use it for all subsequent API calls but never expose it to UI code.

### 4.3 The outbox

```sql
CREATE TABLE outbox (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type     TEXT NOT NULL,           -- 'task', 'project', 'label', ...
  entity_local_id TEXT NOT NULL,
  op              TEXT NOT NULL,           -- 'create' | 'update' | 'delete'
  payload         TEXT NOT NULL,           -- JSON snapshot of changes
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TEXT,                    -- for exponential backoff
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_outbox_next ON outbox(next_attempt_at);
```

Ordering matters: ops are drained FIFO per entity, with cross-entity dependencies resolved by entity_local_id (a task create blocks until its project create lands).

### 4.4 Schema migrations

Use a simple migration runner — Tauri's SQL plugin gives you a `migrations` array at connection time:

```ts
// src/db/migrations.ts
import type { Migration } from '@tauri-apps/plugin-sql';

export const migrations: Migration[] = [
  {
    version: 1,
    description: 'initial schema',
    sql: await import('./migrations/001_initial.sql?raw').then(m => m.default),
    kind: 'up',
  },
  // append new migrations here, never edit existing ones
];
```

Forward-only. Never edit a shipped migration. If you need to undo, ship a new migration that does the undoing.

---

## 5. Persistence Layer

### 5.1 DB wrapper

```ts
// src/db/index.ts
import Database from '@tauri-apps/plugin-sql';
import { migrations } from './migrations';

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load('sqlite:vikunja.db');
    // migrations are registered in tauri.conf.json via the SQL plugin config
  }
  return dbPromise;
}
```

### 5.2 Repositories

One repository per entity. Repositories are the *only* layer that reads/writes SQL. They:

- Map between DB rows and domain types
- Mark rows dirty when changed
- Append outbox entries on mutations

```ts
// src/db/tasks.ts
import { nanoid } from 'nanoid';
import { getDb } from '.';
import type { Task, TaskInput } from '@/domain/task';

export async function createTask(input: TaskInput): Promise<Task> {
  const db = await getDb();
  const local_id = nanoid();
  const now = new Date().toISOString();

  await db.execute('BEGIN');
  try {
    await db.execute(
      `INSERT INTO tasks (local_id, title, description, project_local_id,
                          due_date, priority, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [local_id, input.title, input.description ?? null, input.projectLocalId,
       input.dueDate ?? null, input.priority ?? 0, now]
    );

    await db.execute(
      `INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
       VALUES ('task', ?, 'create', ?, ?)`,
      [local_id, JSON.stringify(input), now]
    );

    await db.execute('COMMIT');
  } catch (e) {
    await db.execute('ROLLBACK');
    throw e;
  }

  return getTaskByLocalId(local_id);
}
```

The DB transaction guarantees that the local change and the outbox entry are either both committed or both rolled back. **Never split these into separate transactions** — that's how you end up with phantom syncs or lost writes.

### 5.3 Reactive reads

Tauri's SQL plugin doesn't have built-in `LIVE` queries (unlike Replicache or PowerSync). We fake reactivity with an in-process event bus:

```ts
// src/db/bus.ts
type Topic = 'tasks' | 'projects' | 'labels' | 'outbox';
const listeners = new Map<Topic, Set<() => void>>();

export function subscribe(topic: Topic, fn: () => void): () => void {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic)!.add(fn);
  return () => listeners.get(topic)!.delete(fn);
}

export function notify(topic: Topic): void {
  listeners.get(topic)?.forEach(fn => fn());
}
```

Repository writes call `notify('tasks')` after committing. TanStack Query subscriptions call `queryClient.invalidateQueries({ queryKey: ['tasks'] })` on notification. Crude but effective.

---

## 6. API Client

### 6.1 Type generation

Vikunja's OpenAPI spec is at `/api/v1/docs.json` on every instance. We generate types at build time:

```jsonc
// package.json
{
  "scripts": {
    "generate:api": "openapi-typescript https://try.vikunja.io/api/v1/docs.json -o src/api/schema.ts"
  }
}
```

Commit the generated `schema.ts`. Regenerate on Vikunja version bumps; diff in code review.

### 6.2 Client

```ts
// src/api/client.ts
import createClient from 'openapi-fetch';
import type { paths } from './schema';
import { getAuthToken, getServerUrl } from '@/auth';

export function createApiClient() {
  return createClient<paths>({
    baseUrl: `${getServerUrl()}/api/v1`,
    headers: {
      get Authorization() {
        const t = getAuthToken();
        return t ? `Bearer ${t}` : '';
      },
    },
  });
}
```

### 6.3 The PUT-creates-POST-updates gotcha

Vikunja uses non-standard verb semantics:

| Verb | Vikunja semantics |
|---|---|
| `GET` | read |
| `PUT` | **create** |
| `POST` | **update** (partial) |
| `DELETE` | delete |

The generated TS types will reflect this — the create endpoints will be `PUT` operations. Don't fight it; document it in code review.

### 6.4 Auth strategy

Two paths:

1. **API token** (preferred, works for both Cloud and self-hosted). User creates one in Vikunja web UI → Settings → API Tokens, pastes into our login screen. We store it in the OS keychain via `@tauri-apps/plugin-stronghold` or `keyring-rs` via a small custom command.
2. **Username/password → JWT** (self-hosted only). POST to `/api/v1/login`, store the JWT, refresh before expiry. Same secure storage path.

```ts
// src/auth/storage.ts
import { Stronghold } from '@tauri-apps/plugin-stronghold';
// ...stores token & server URL behind a derived key
```

We **never** store credentials in plaintext on disk and **never** log them.

### 6.5 Error handling

Wrap every API call in a thin layer that normalizes Vikunja's error shape:

```ts
// src/api/errors.ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | null,   // Vikunja's custom error code
    public readonly message: string,
    public readonly retryable: boolean,
  ) { super(message); }
}

export function classify(status: number): { retryable: boolean } {
  if (status >= 500) return { retryable: true };
  if (status === 408 || status === 429) return { retryable: true };
  return { retryable: false };
}
```

The sync engine uses `retryable` to decide whether to back off or surface to the user.

---

## 7. Sync Engine

The heart of the app. Designed around three loops:

1. **Push loop** — drains the outbox to the server.
2. **Pull loop** — fetches server changes since last sync.
3. **Reconciliation** — periodic full-list compare to detect server-side deletions.

### 7.1 Push loop

```ts
// src/sync/push.ts
export async function drainOutbox(api: ApiClient, db: Database): Promise<void> {
  const ops = await db.select<OutboxRow[]>(
    `SELECT * FROM outbox
     WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
     ORDER BY id ASC
     LIMIT 50`,
    [new Date().toISOString()]
  );

  for (const op of ops) {
    try {
      await executeOp(api, db, op);
      await db.execute('DELETE FROM outbox WHERE id = ?', [op.id]);
    } catch (e) {
      const isRetryable = e instanceof ApiError && e.retryable;
      const attempts = op.attempts + 1;

      if (!isRetryable || attempts >= 10) {
        // surface to user, move to dead-letter table
        await markFailed(db, op, e);
      } else {
        const delay = Math.min(60_000, 2 ** attempts * 1000);  // cap at 60s
        await db.execute(
          `UPDATE outbox SET attempts = ?, last_error = ?, next_attempt_at = ?
           WHERE id = ?`,
          [attempts, String(e), new Date(Date.now() + delay).toISOString(), op.id]
        );
      }
      break;  // stop draining; preserve order
    }
  }
}
```

Key properties:

- **FIFO per entity.** If we fail to push a create, we stop and retry rather than push subsequent updates against a not-yet-existing server entity.
- **Bounded retries.** Ten attempts with exponential backoff, then dead-letter and notify the user.
- **Idempotent ops.** Updates and deletes are naturally idempotent. Creates are guarded by checking `server_id IS NULL` before issuing the PUT.

### 7.2 ID mapping

When a create succeeds, we record the server ID and rewrite any pending outbox payloads that reference the local ID:

```ts
async function onCreateSuccess(
  db: Database,
  entityType: string,
  localId: string,
  serverId: number,
): Promise<void> {
  await db.execute('BEGIN');
  try {
    // 1. Update the entity row
    await db.execute(
      `UPDATE ${entityType}s SET server_id = ?, synced_at = ?, dirty = 0
       WHERE local_id = ?`,
      [serverId, new Date().toISOString(), localId]
    );

    // 2. Rewrite outbox payloads that reference this local_id
    // (in practice the executor reads server_id at execute time, not from payload,
    // so this is mainly defensive)

    await db.execute('COMMIT');
  } catch (e) {
    await db.execute('ROLLBACK');
    throw e;
  }
}
```

In practice the cleanest pattern is: outbox payloads store *local* IDs only; the executor resolves them to server IDs at send time by looking them up. If a referenced entity hasn't been created yet, the executor blocks that op (returns `entity_not_yet_synced`) and the push loop will retry it after the dependency syncs.

### 7.3 Pull loop

Vikunja exposes a list endpoint with filter support. We use the `filter` query parameter with `updated > lastSyncAt`:

```ts
// src/sync/pull.ts
export async function pullChanges(
  api: ApiClient,
  db: Database,
  since: string,  // ISO timestamp
): Promise<void> {
  let page = 1;
  while (true) {
    const { data, response } = await api.GET('/tasks/all', {
      params: {
        query: {
          filter: `updated > "${since}"`,
          page,
          per_page: 50,
          sort_by: 'updated',
          order_by: 'asc',
        },
      },
    });
    if (!data) break;

    for (const remoteTask of data) {
      await upsertRemoteTask(db, remoteTask);
    }

    const totalPages = parseInt(
      response.headers.get('x-pagination-total-pages') ?? '1',
      10
    );
    if (page >= totalPages) break;
    page++;
  }

  await db.execute(
    `UPDATE sync_state SET tasks_synced_at = ?`,
    [new Date().toISOString()]
  );
}
```

Repeat per entity type. Order matters: projects before tasks, labels before task-label links.

### 7.4 Conflict resolution

When `pullChanges` encounters a remote task whose local copy is `dirty = 1`, we have a conflict.

Strategy: **field-level last-writer-wins with surfacing.**

- Compare each editable field on the remote vs the local (uncommitted) version.
- For fields the user changed locally that *also* changed remotely → conflict. Log to a `conflicts` table and surface a UI prompt.
- For fields only changed remotely → accept remote.
- For fields only changed locally → keep local; the outbox push will overwrite the server.

```ts
type ConflictResolution =
  | { kind: 'no-conflict' }
  | { kind: 'auto-merge'; merged: Task }
  | { kind: 'needs-user'; local: Task; remote: Task; fields: string[] };

function resolve(local: Task, remote: Task, lastSyncedAt: string): ConflictResolution {
  const conflicts: string[] = [];
  const merged = { ...local };

  for (const field of EDITABLE_FIELDS) {
    const localChanged = local[field] !== local._lastSynced?.[field];
    const remoteChanged = remote[field] !== local._lastSynced?.[field];

    if (localChanged && remoteChanged && local[field] !== remote[field]) {
      conflicts.push(field);
    } else if (remoteChanged) {
      merged[field] = remote[field];
    }
  }

  if (conflicts.length === 0) {
    return merged === local ? { kind: 'no-conflict' } : { kind: 'auto-merge', merged };
  }
  return { kind: 'needs-user', local, remote, fields: conflicts };
}
```

For this to work, we need a `_lastSynced` snapshot — store the last known server state as JSON in a sibling column or table. Adds a bit of storage; pays for itself the first time it saves the user from losing edits.

### 7.5 Deletions

Vikunja doesn't expose a tombstone feed. So we periodically (every ~15 min, or on user "refresh") fetch the current set of IDs server-side and diff:

```ts
async function reconcileDeletions(api: ApiClient, db: Database) {
  const serverIds = await fetchAllTaskIds(api);  // shallow, ID-only
  const localServerIds = await db.select<{ server_id: number }[]>(
    `SELECT server_id FROM tasks WHERE server_id IS NOT NULL`
  );
  const deleted = localServerIds.filter(l => !serverIds.has(l.server_id));
  for (const { server_id } of deleted) {
    await db.execute(`DELETE FROM tasks WHERE server_id = ?`, [server_id]);
  }
}
```

Heavy-ish; rate-limit it.

### 7.6 Scheduling & lifecycle

The sync engine runs in the main webview process (no separate worker needed for the volume we're dealing with) but uses `requestIdleCallback`-style scheduling.

| Trigger | Action |
|---|---|
| App start (online) | Full pull, then drain outbox |
| Network reconnect (`navigator.online`) | Drain outbox, light pull |
| Outbox write | Schedule drain in ~500ms (debounced) |
| Periodic timer (60s) | Light pull |
| Periodic timer (15 min) | Reconcile deletions |
| User-initiated "refresh" | Full pull + reconcile |
| App focus regained | Light pull |

All triggers funnel through a single scheduler that ensures only one sync cycle runs at a time per type.

### 7.7 Real-time considerations

Vikunja has no WebSocket/SSE endpoint as of writing. Options if real-time becomes important later:

1. **Webhooks → user-hosted relay → Tauri push notification** — overkill for a personal app.
2. **More aggressive polling** when the app is focused (e.g., 10s).
3. **Native Vikunja WS support** — keep an eye on upstream issues.

For v1, polling at the cadence above is fine.

---

## 8. State Management

### 8.1 Server state — TanStack Query

All entity reads go through query hooks backed by the local DB. The sync engine invalidates relevant queries via the event bus.

```ts
// src/queries/tasks.ts
export function useTasks(projectLocalId: string) {
  return useQuery({
    queryKey: ['tasks', { projectLocalId }],
    queryFn: async () => {
      const db = await getDb();
      return db.select<Task[]>(
        `SELECT * FROM tasks WHERE project_local_id = ? AND deleted = 0
         ORDER BY position ASC, created_at DESC`,
        [projectLocalId]
      );
    },
    staleTime: Infinity,  // we control invalidation manually via the bus
  });
}
```

Mutations are *not* TanStack Query mutations directly — they're calls into our repository layer, which writes the DB and outbox in one transaction. Optimistic updates are essentially free because the DB write *is* the optimistic update.

### 8.2 Client state — Zustand

Pure UI state: selected task ID, sidebar collapsed, search query, modal visibility. One store per major surface, or one global store with slices. Keep it small; if it touches the DB or the server, it doesn't belong here.

```ts
// src/stores/ui.ts
import { create } from 'zustand';

interface UiState {
  selectedTaskLocalId: string | null;
  sidebarCollapsed: boolean;
  setSelected: (id: string | null) => void;
  toggleSidebar: () => void;
}

export const useUi = create<UiState>((set) => ({
  selectedTaskLocalId: null,
  sidebarCollapsed: false,
  setSelected: (id) => set({ selectedTaskLocalId: id }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
```

Persist sidebar state etc. to localStorage via Zustand's `persist` middleware.

---

## 9. UI Architecture

### 9.1 Layout

Three-pane main window:

```
┌────────────┬─────────────────────────┬────────────────────────┐
│            │                         │                        │
│  Sidebar   │   Task list / Board     │   Detail               │
│            │                         │                        │
│  Projects  │   Per-project tasks     │   Selected task        │
│  Filters   │   View switcher:        │   Edit fields, labels  │
│  Labels    │   - List                │   Comments, history    │
│            │   - Kanban              │                        │
│            │   - Table               │                        │
│            │   - Gantt (v2)          │                        │
└────────────┴─────────────────────────┴────────────────────────┘
```

Detail pane is collapsible. Sidebar is collapsible. Title bar is custom (Tauri `decorations: false` + native traffic lights on macOS via `titleBarStyle: "overlay"`).

### 9.2 Key views

| View | Notes |
|---|---|
| **Inbox** | Tasks without a project, or in the user's default project |
| **Today** | Tasks with `due_date <= today` |
| **Upcoming** | Tasks due in the next 7 days, grouped by day |
| **Project list** | Tasks in a project, filterable & sortable |
| **Project kanban** | Tasks grouped by status (or any single-select label-like field) |
| **Filters** | Render saved filters; same task list UI |
| **Search** | Full-text against local DB using SQLite FTS5 |
| **Settings** | Server, account, sync status, shortcuts, appearance |
| **Quick add** | Global-shortcut popover for fast capture |

### 9.3 Quick add

Tauri global shortcut (`Cmd+Shift+A` default) opens a small frameless window. Single text field with natural-language parsing:

```
Buy milk #shopping !1 ^tomorrow @alice
```

- `#tag` → label
- `!1` … `!5` → priority
- `^date` → due date (parsed by chrono-node)
- `@user` → assignee

Submits, creates task locally, closes window. Sync happens in background.

### 9.4 Conflict UI

When a conflict is detected, drop a banner on the affected task showing both versions side-by-side, with per-field "keep mine" / "use theirs" / "merge" actions. Don't surface conflicts globally — they're contextual.

### 9.5 Offline indicator

Persistent but unobtrusive: a small dot in the status bar with three states.

| State | Color | Meaning |
|---|---|---|
| Synced | green | Outbox empty, last pull <1m ago |
| Pending | amber | Items in outbox or actively syncing |
| Offline / error | red | No connection or repeated failures |

Click for sync details modal.

### 9.6 Accessibility

- All interactive elements keyboard-navigable.
- All shortcuts customizable in settings.
- High contrast mode honors OS setting.
- Reduce motion honored.
- Screen reader labels on all icon-only buttons.
- Font scaling honors OS setting (Tauri webview inherits).

---

## 10. System Integration

### 10.1 Tray icon

Optional, opt-in via settings. Shows next task due today, quick-add menu item, sync status. Plugin: `@tauri-apps/plugin-tray-icon` (built into Tauri 2 core).

### 10.2 Notifications

Plugin: `@tauri-apps/plugin-notification`.

- Task due reminders (scheduled via local SQLite + a Tauri timer; we don't rely on Vikunja's reminder push since there isn't one)
- Sync failure notifications (rate-limited; one per session)
- @mention in comments (on next pull cycle)

### 10.3 Global shortcuts

Plugin: `@tauri-apps/plugin-global-shortcut`.

| Default | Action |
|---|---|
| `Cmd/Ctrl+Shift+A` | Quick add |
| `Cmd/Ctrl+Shift+V` | Show/hide main window |
| `Cmd/Ctrl+K` | Command palette (in-window) |

All rebindable.

### 10.4 Autostart

Plugin: `@tauri-apps/plugin-autostart`. Off by default; togglable from settings.

### 10.5 Deep links

Plugin: `@tauri-apps/plugin-deep-link`.

Register `vikunja://` scheme. Handle:

- `vikunja://task/<server_id>` → open task in detail pane
- `vikunja://project/<server_id>` → switch to project
- `vikunja://quick-add?text=...` → open quick add prefilled

Useful for Raycast/Alfred/Spotlight extensions and the browser extension (future).

### 10.6 Single instance

Plugin: `@tauri-apps/plugin-single-instance`. Second launch attempt focuses the running window and passes args (for deep links).

### 10.7 OS-specific niceties

- **macOS**: native menu bar with standard items, `Cmd+,` for settings, Dock badge for overdue count, Spotlight indexing of tasks (via Core Spotlight — needs a small Rust command).
- **Windows**: Jump List with recent projects, badge on taskbar, Toast notifications with action buttons.
- **Linux**: `.desktop` entries for quick-add, libnotify for notifications, system tray support varies (warn user on KDE/Wayland edge cases).

---

## 11. Project Structure

Current layout (M5-era; will grow as M6+ lands):

```
cria/
├── src-tauri/                  # Rust shell (touch as little as possible)
│   ├── src/
│   │   ├── main.rs             # entrypoint
│   │   ├── lib.rs              # plugin setup, window config, migrations registry
│   │   └── tx.rs               # execute_tx command (multi-statement atomic transactions)
│   ├── tauri.conf.json
│   ├── tauri.dev.conf.json     # side-by-side dev-build overlay
│   ├── capabilities/           # Tauri 2 ACL
│   └── icons/
├── src/                        # TypeScript app
│   ├── api/
│   │   ├── client.ts
│   │   ├── errors.ts
│   │   ├── user.ts
│   │   └── schema.ts           # generated
│   ├── auth/
│   │   ├── storage.ts          # token storage (localStorage; see CLAUDE.md gotcha)
│   │   └── store.ts            # auth zustand store
│   ├── db/
│   │   ├── index.ts            # connection + withTx batching + serial queue
│   │   ├── bus.ts              # change notifications
│   │   ├── migrations/
│   │   │   ├── 001_initial.sql
│   │   │   └── 002_task_fields.sql
│   │   ├── tasks.ts            # repository
│   │   ├── projects.ts
│   │   ├── labels.ts
│   │   ├── task-assignees.ts
│   │   ├── conflicts.ts
│   │   ├── syncMerge.ts        # central dirty-guard + field-level merge
│   │   └── user.ts
│   ├── domain/                 # types + zod schemas
│   │   ├── task.ts
│   │   ├── project.ts
│   │   ├── label.ts
│   │   ├── task-assignee.ts
│   │   └── user.ts
│   ├── sync/
│   │   ├── push.ts             # outbox drain
│   │   ├── pull.ts             # delta fetch
│   │   ├── reconcile.ts        # deletion sweep
│   │   └── usePeriodicSync.ts  # 60s timer + focus trigger
│   ├── queries/                # TanStack Query hooks
│   │   ├── tasks.ts
│   │   ├── projects.ts
│   │   ├── labels.ts
│   │   ├── taskLabels.ts
│   │   ├── outbox.ts
│   │   ├── outboxRows.ts
│   │   ├── conflicts.ts
│   │   ├── updater.ts
│   │   └── user.ts
│   ├── stores/                 # Zustand stores
│   │   ├── ui.ts
│   │   └── pendingDeletes.ts
│   ├── features/
│   │   ├── shell/              # three-pane shell, header, footer, banners
│   │   ├── projects/
│   │   ├── tasks/              # task list + add input + quick-add preview
│   │   ├── task-detail/        # detail pane, TipTap editor, TaskActions sidebar
│   │   └── login/
│   ├── lib/
│   │   ├── quickAddParser.ts   # natural-language parser (chrono-node + tokens)
│   │   ├── openExternal.ts     # routes <a> clicks through plugin-opener
│   │   ├── sanitize.ts         # DOMPurify wrapper for editor output
│   │   └── cn.ts               # tailwind class merger
│   ├── tauri/                  # Tauri plugin wrappers
│   │   ├── autostart.ts
│   │   ├── globalShortcut.ts
│   │   ├── notification.ts
│   │   └── updater.ts
│   ├── components/             # shared UI: ConflictModal, QuickAddModal,
│   │                           # OutboxModal, LabelManagerModal, UndoToast, ui/
│   ├── utils/
│   ├── App.tsx
│   └── main.tsx
├── tests/
│   └── unit/                   # Vitest — sync, syncMerge, taskToBody,
│                               # quickAddParser, upsertFromServer, pendingDeletes
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── README.md
```

Notable absences vs the original sketch: no TanStack Router yet (single
shell view; routing-by-state via Zustand), no Playwright E2E, no `features/
kanban` or `features/settings` (M9 and later). Filled in by M6+.

---

## 12. Build & Distribution

### 12.1 Build commands

```jsonc
// package.json scripts
{
  "dev": "tauri dev",
  "build": "tauri build",
  "build:mac-arm": "tauri build --target aarch64-apple-darwin",
  "build:mac-x86": "tauri build --target x86_64-apple-darwin",
  "build:mac-universal": "tauri build --target universal-apple-darwin",
  "build:win": "tauri build --target x86_64-pc-windows-msvc",
  "build:linux": "tauri build",
  "generate:api": "openapi-typescript $VK_URL/api/v1/docs.json -o src/api/schema.ts"
}
```

### 12.2 Code signing

| Platform | Approach |
|---|---|
| macOS | Apple Developer ID Application cert + notarization via `tauri-action`. For personal use, ad-hoc sign (`identity: "-"`) and live with right-click → Open. |
| Windows | EV or OV code signing cert (Sectigo, DigiCert) or accept SmartScreen warnings for personal use |
| Linux | No mandatory signing; AppImage + `.deb` + Flatpak |

### 12.3 Auto-update

Plugin: `@tauri-apps/plugin-updater`. Self-host the update manifest on GitHub Releases or any HTTP endpoint. Sign updates with a private Ed25519 key, ship the public key in `tauri.conf.json`.

### 12.4 CI

GitHub Actions matrix build: macOS-arm + macOS-x86 (or universal) + Windows + Ubuntu. Artifacts uploaded to a draft release on tag push. Manual review then publish.

---

## 13. Testing Strategy

### 13.1 Unit (Vitest)

- All sync logic: conflict resolution, ID mapping, outbox ordering, retry/backoff. **This is where the bugs will live; test exhaustively.**
- Quick-add parser
- Date utilities
- Filter expression rendering (if we end up generating Vikunja filter expressions from a builder UI)

### 13.2 Integration

- Sync engine against a mock API (msw-style) backed by an in-memory SQLite (`better-sqlite3` in test, the real plugin in app).
- Migration round-trips (apply v1, write data, apply v2, assert no loss).

### 13.3 E2E (Playwright + tauri-driver)

A few critical flows only — these are slow:

- Onboarding: enter URL + token, see projects load
- Create task offline → reconnect → see it on server
- Edit same task locally and "remotely" (via direct API call in test) → see conflict UI
- Quick-add via global shortcut

### 13.4 Manual smoke testing

A checklist file (`docs/smoke-test.md`) for each release: launch, login, create, edit, delete, switch projects, lose network, regain network, quit, relaunch, verify state.

---

## 14. Implementation Milestones

Cria is targeting a **Todoist-feeling** client over Vikunja. The first four milestones deliver the offline-first / outbox foundation; the rest is the UX climb to match the polish bar a daily-driver task app demands.

Milestones are defined by what's working, not by calendar time. Ship each one when its exit criteria are met.

### Shipped foundation (M0–M6)

| | What | Status |
|---|---|---|
| **M0** | Skeleton — Tauri + Vite + React + SQLite + sign-in | ✅ |
| **M1** | Read-only sync — projects + tasks + labels render, 60s background refresh | ✅ |
| **M2** | Local writes + outbox — create / edit / delete tasks round-trip to server | ✅ |
| **M3** | Conflicts + deletion reconcile — dirty-guard/conflict logic unit-tested (`tests/unit/syncMerge.test.ts`) **and** the two-client conflict UI verified end-to-end (#32 closed: diff renders, "keep mine"/"use server's" resolve cleanly). Known gap: conflicts only surface on app launch, not while running — periodic sync doesn't poll the open view (#33). Considered for a follow-up "live sync" pass (see end of §14) | 🟡 |
| **M4** | Native polish — Tauri plugins (notification, autostart, global shortcut, tray) and a Rust-side `execute_tx` for real atomic transactions | ✅ |
| **M4.5** | Auto-update distribution — updater plugin, signing, release workflow, `update.json` on GitHub Pages, silent download + restart banner. Shipped end-to-end (`v0.1.0-alpha` → `v0.3.0-beta.1`) | ✅ |
| **M5** | Input parity with Todoist — NL quick-add, TipTap WYSIWYG editor, inline metadata pickers, label mutations through the outbox, external-link handling | ✅ |
| **M6** | Smart views & search — Today / Upcoming / Inbox + saved filters + FTS5 across the local DB | ✅ |

**Current release:** `v0.4.2`. The daily-driver bar (M0–M5) is met; M6
shipped in `v0.4.0`. The climb from here is the polish/power-user bar
(M7–M9) plus selective pickups from M10 (attachments already mostly
landed via PR #41). Versioning is plain `0.x.y` (no `-beta`) — see the
[Versioning policy](#versioning-policy) below.

### M4.5 — Auto-update distribution

Auto-update so users receive new versions without re-downloading, re-installing, or reconfiguring API tokens. The app data directory (credentials, SQLite DB, preferences) is preserved across updates — only the binary is swapped.

- **Updater plugin** — `tauri-plugin-updater` wired into Cargo.toml, lib.rs, tauri.conf.json, and capabilities
- **Update manifest** — hosted at `https://pocketcoder.github.io/cria/update.json` (GitHub Pages), listing per-platform download URLs + Ed25519 signatures
- **Signing** — Ed25519 key pair; private key stored as GitHub secret, public key baked into the app bundle
- **Release workflow** — GitHub Actions triggered by `v*` tags: builds macOS aarch64 + x86_64 DMGs, signs both, creates a GitHub Release, and publishes the update manifest to `gh-pages`
- **Frontend integration** — `checkUpdate()` on startup, silent background download, "Update ready — restart to apply" banner in the footer bar, `installUpdate()` on click
- **Privacy** — the updater contacts only the update manifest URL; no telemetry, no phone-home beyond version checks

**Exit criteria:** a user on v0.0.0-alpha gets a banner prompting restart when v0.1.0 is released. One click restarts into the new version. All credentials, tasks, and settings survive the update.

### M5 — Input parity with Todoist ✅ (shipped)

The point at which the app stops feeling like a wrapper. This is the headline milestone for "Todoist clone." All bullets below are landed.

- **Natural-language quick-add** in the inline "Add a task…" field and the global Cmd+Shift+A modal:
  - `Buy milk tomorrow at 5pm #shopping !2 @alice`
  - Parser handles dates (via chrono-node), `#label`, `!priority`, `@assignee`, project hops
  - Token-coloured live preview as the user types
- **WYSIWYG description editor** (TipTap) replacing the HTML textarea
  - Bold / italic / underline / strike, headings, lists, blockquote, inline + block code, links
  - Slash-command menu (`/heading`, `/bullet`, `/code`, …)
  - Smart paste (auto-link URLs, strip foreign HTML)
  - Renders identically to Vikunja's own web client (both use TipTap)
- **Inline metadata pickers** in the detail pane:
  - Due / start / end date popover with calendar
  - Priority pill (0–5) with keyboard
  - Project chooser combobox
  - Label multi-select with create-as-you-type
- **Label mutations** (apply / remove / create) routed through the outbox alongside task mutations
- **External-link handling** — `<a>` clicks in descriptions / notes / comments open via Tauri `shell.open` in the OS default browser, not the webview itself

**Exit criteria:** a Todoist user could sit down and create or edit a complete task — title, description, due date, priority, labels — without touching the mouse beyond the initial focus. Descriptions look the same in Cria and in Vikunja's web UI.

### M6 — Smart views & search

- **Today** — tasks due today across every project, single grouped list
- **Upcoming** — next 7 days, grouped by day
- **Inbox** — convert from project to a real smart view (tasks with no project, or in the user's default)
- **Saved filters** — render Vikunja's filter DSL, edit via a small expression builder; persist locally
- **Full-text search** across the local SQLite using FTS5, results inline as you type
- Search and smart views share the same task-list rendering as projects do

**Exit criteria:** the user opens Cria in the morning and Today tells them what to do. Search is sub-100ms on a 10k-task local database.

### M7 — Keyboard-first navigation

- **Command palette** (Cmd+K): open project, jump to task, run any action by name
- **Per-row shortcuts**: j/k or arrows to move, Enter to open detail, Space to check, `e` edit title, `d` set date, `l` labels, `p` priority, `#` move to project
- All shortcuts **rebindable** in settings
- Global Cmd+Shift+A (already wired) opens the natural-language quick-add modal anywhere

**Exit criteria:** every common action is reachable without the trackpad.

### M8 — Hierarchy, recurrence, reminders

- **Reminders** ✅ (PR #39, stacked) — render `task_reminders`, schedule local notifications via plugin-notification when due, deliver while the app is open or sitting in the tray, surface a System-Settings deep-link when macOS notifications are off, macOS Dock badge for outstanding reminders. Server-side overdue reminders still fire via Vikunja's own email path independently.
- **Sub-tasks**: render Vikunja's `task_relations` (`subtask` kind) as an indented, collapsible tree under each parent. Detail card surfaces "parent task" linkback. Create / promote / demote works through the existing outbox path
- **Recurring tasks**: surface `repeat_after` / `repeat_mode` in the detail pane with a human-readable editor ("Every weekday", "Monthly on the 1st"). Mark-done auto-rolls the dates per Vikunja's semantics

**Exit criteria:** the weekly "Take out the bins" task fires its reminder on time and reappears the day after it's completed; sub-tasks render as a collapsible tree with full keyboard navigation parity to the flat list, with no web-UI intervention.

### M9 — Reorder, drag-and-drop, Kanban

- Drag-and-drop **task reordering** within a list (dnd-kit), persisting per-view positions through the outbox
- **Kanban view** per project: column per bucket, drag tasks between
- **Table view**: dense, sortable, multi-column

**Exit criteria:** users who organise their day in Kanban can run it from Cria.

### M10 — Stretch

Individually shippable; pulled in by demand:
- **Attachments** ✅ (PR #41, stacked on #39) — list below description, paperclip indicator on rows, multipart upload (button + drag-drop zone), per-row delete + download, inline images in descriptions (Vikunja-compatible `data-src` + auth-fetch pattern so the same description renders identically in Cria and Vikunja-web), click-to-preview lightbox. Local-cache-with-LRU-eviction is still TODO; for now blob URLs are kept per-session in a module-level cache and revoked when the session ends
- **Comments + @mentions** with notification on next pull
- **Gantt** view
- **Per-project notes** — a markdown notebook docked to the sidebar

### Daily-driver and polish bars

- **Daily-driver** target: M0–M5. A user who lives in Todoist could switch.
- **Polish** bar: M0–M7. A user who reviews productivity apps for fun wouldn't downgrade their experience.
- **Power-user** bar: M0–M9. The app stops needing the web UI for anything routine.

**Daily-driver target:** M0 through M3 is the minimum for the app to be the user's primary client. M4 is the minimum for it to feel polished. M5+ broadens the audience.

### Versioning policy

Plain [SemVer](https://semver.org) `0.MINOR.PATCH`, **no prerelease suffix**.
The `0.` major *is* the stability signal — under SemVer a `0.x` release makes
no compatibility promises, so an extra `-alpha`/`-beta` tag is redundant (and
was actively misleading: "beta" implies feature-complete + stabilising, but
we're still building out M6–M9). Rules:

- **Minor** (`0.4.0`, `0.5.0`, …) — one per milestone (new features).
- **Patch** (`0.3.1`, `0.3.2`, …) — fixes / polish within a milestone.
- **`1.0.0`** carries the weight: "stable, daily-driver-ready for other
  people, and I won't casually break their local data or token format."
  Maps to the polish bar (M7) + macOS notarisation.

The `v0.1.0-alpha` → `v0.3.0-beta.1` tags were the old scheme; `v0.3.0` is
the first under this policy (it promotes `0.3.0-beta.1` and folds in the
fixes that landed after it). SemVer ordering means installed beta clients
still see `0.3.0` as an upgrade.

Dates below are effort-ordered, not deadlines — ship each tag when its exit
criteria are met.

| Version | Contents | Milestone | Rough effort |
|---|---|---|---|
| `v0.3.0` | M5 complete + offline-render fix + TaskList papercuts (#19, #20, #21) + undo-delete toast (#25) | M0–M5 | ✅ shipped |
| `v0.3.1` | Header/footer cleanup — drop app title (#26), remove redundant status pill | polish | ✅ shipped |
| `v0.4.0` | Today / Upcoming / Inbox smart views, FTS5 search, saved filters | M6 | ✅ shipped |
| `v0.4.x` | Reminders (PR #39) + attachments incl. inline images (PR #41) — slips into the 0.4.x line because the work landed alongside M6's polish rather than waiting for its own milestone slot | M8 partial, M10 partial | 🟡 in PR |
| `v0.5.0` | **Sub-tasks tree + recurrence editor** — the rest of M8, now that reminders is done | M8 | ~2 wks |
| `v0.6.0` | Command palette (Cmd+K), per-row shortcuts, rebindable keys | M7 | ~1.5 wks |
| `v0.7.0` | Drag-to-reorder, Kanban, table view | M9 | ~2–3 wks |
| `v0.8.0` | **Live sync (WebSockets)** — replace 60s polling, close #33 (conflicts during running), make the app feel native (see §14a below) | M3.5 | ~1.5–2 wks |
| `v0.9.0` | Pick-up wins: Vikunja importers (Todoist/Trello/Asana/Microsoft To Do/TickTick — already implemented server-side, expose via Settings), task/project duplicate, export-my-data | drive-bys | ~3–5 days total |
| `v1.0.0` | macOS notarisation + polish + M3 fully signed off | graduation | ~1 wk |
| `v1.x` | Remaining M10 (comments + @mentions, Gantt, per-project notes, attachment LRU cache) — by demand | M10 | per-feature |

**The headline gap is now M7 + M8 sub-tasks/recurrence.** Reminders and
attachments slipped in alongside M6 — both were small enough to land
without their own minor bump. After M7/M8 the daily-driver / polish
bars are met for the second half of the Todoist parity table.

Sequencing risks worth budgeting for:
- **FTS5 (M6)** needs a `003_fts.sql` migration (virtual table + sync
  triggers) — first schema change since 002. ✅ landed.
- **Recurrence (M8)** must match Vikunja's `repeat_mode` roll-on-complete
  semantics exactly; reminders ✅ wired through `plugin-notification` and
  survive the tray.
- **Reorder (M9)** fights the `sort_by=position` HTTP 400 gotcha — positions
  are per-view-only, so position persistence needs design time.
- **Notarisation** (the Apple Developer cert) gates a friction-free 1.0
  install; until then first launch trips the "unidentified developer"
  warning. Revisit before 1.0 or document the right-click-open workaround in
  release notes.

### M3.5 — Live sync via WebSockets (proposed)

Vikunja's server exposes a WebSocket endpoint (`pkg/websocket/`) that
pushes per-entity updates to connected clients. Adopting it would close
three things at once:

- **#33** — conflicts during a running session. Today the periodic pull
  fires every 60s, so two clients editing the same task can both write
  for up to a minute before the merge runs and the conflict surfaces.
  With push the local view sees the other client's change in seconds.
- **Polling cost** — the 60s `pullAllTasks` cycle goes away. The outbox
  push stays (it's still how *we* write); pulls become event-triggered.
- **Perceived "native" feel** — open the app on two devices, change a
  title on one, watch it animate on the other. Sells the daily-driver
  story even harder.

The work is roughly: connect on auth, maintain a heartbeat, dispatch
inbound deltas through the same `upsert*FromServer` helpers the polling
path uses, fall back to polling if the socket drops. Should be slotted
*after* M7/M8 so it has solid client behaviour to layer onto, but
*before* `v1.0.0` because it's the kind of foundational shift that gets
harder once the user base widens.

### Vikunja-side backlog (free wins worth picking up opportunistically)

The Vikunja server already implements features we haven't surfaced. These
are cheap because the backend cost is zero — Cria just exposes a UI.
Slot them into any minor release that has slack.

| Feature | Endpoint(s) | Effort |
|---|---|---|
| **Import from Todoist / Trello / Asana / Microsoft To Do / TickTick / Vikunja-file** | `POST /migration/{service}/migrate` + a small "Import" panel in Settings | ~1 day |
| **Duplicate task** | `PUT /tasks/{taskID}/duplicate` | ~2 hours |
| **Duplicate project** (with children) | `PUT /projects/{projectID}/duplicate` | ~2 hours |
| **Export my data** | `POST /user/export/request` → poll → download | ~3 hours |
| **CalDAV docs** | Nothing to build — settings page link explaining how to subscribe Calendar.app to `<server>/dav/projects` | ~30 min |
| **Webhook management UI** | `GET/POST/PUT/DELETE /projects/{id}/webhooks` | ~half day |
| **In-app notification inbox** | `GET /notifications`, mark-read endpoints | ~1 day (likely fold into a comments milestone) |

---

## 15. Open Questions / Decisions to Defer

- **Encryption at rest** — SQLite SEE? SQLCipher? Or rely on OS-level disk encryption? Lean toward the latter for v1.
- **Attachment storage limits** — cap local cache to ~500 MB with LRU eviction?
- **Multi-account support** — single account in v1, but design `auth` and `db` to be account-scoped from day one (DB filename per account).
- **Plugin/extension API** — defer indefinitely.
- **Filter expression builder** — Vikunja's filter syntax is rich; do we ship a visual builder or just a text input with autocomplete? Probably text + autocomplete for v1.
- **Telemetry** — none in v1. If added later, opt-in only, locally aggregated, exposed in settings.
- **Calendar integration** — CalDAV server-side already exists. Should we read tasks from system calendar (EventKit/etc.) as well? Probably no — it's the wrong direction.

---

## Appendix A — Useful Vikunja API endpoints

| Endpoint | Verb | Use |
|---|---|---|
| `/info` | GET | Server version, auth methods (no auth required) |
| `/login` | POST | Username/password → JWT |
| `/user` | GET | Current user |
| `/projects` | GET | List projects |
| `/projects` | PUT | Create project |
| `/projects/{id}` | POST | Update project |
| `/projects/{id}` | DELETE | Delete project |
| `/projects/{id}/tasks` | GET, PUT | List / create tasks in a project |
| `/tasks/all` | GET | All tasks across projects, with filters |
| `/tasks/{id}` | GET, POST, DELETE | Read / update / delete task |
| `/tasks/{id}/labels` | PUT, DELETE | Attach / detach labels |
| `/labels` | GET, PUT | List / create labels |
| `/filters` | GET, PUT | Saved filters |
| `/notifications` | GET | Bell-icon items |

Full reference at `<your-instance>/api/v1/docs`.

---

## Appendix B — Reading list

- Tauri 2 docs: <https://v2.tauri.app>
- TanStack Query patterns: <https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates>
- The "outbox pattern" (originally from messaging): <https://microservices.io/patterns/data/transactional-outbox.html>
- Offline-first inspiration: Linear's "sync engine" talks, Replicache docs
- Conflict resolution: "Designing Data-Intensive Applications" ch. 5

---

*End of spec.*
