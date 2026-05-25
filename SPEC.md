# Vikunja Desktop Client — Technical Specification

A polished, offline-capable, cross-platform desktop client for [Vikunja](https://vikunja.io), built with Tauri 2 and TypeScript.

**Working name:** TBD (`vk`, `Kunja`, `Vikunja Native`, your call.)

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

```
vikunja-desktop/
├── src-tauri/                  # Rust shell (touch as little as possible)
│   ├── src/
│   │   ├── main.rs             # Plugin setup, window config
│   │   └── commands.rs         # Custom commands (e.g., Spotlight, keychain)
│   ├── tauri.conf.json
│   ├── capabilities/           # Tauri 2 ACL
│   └── icons/
├── src/                        # TypeScript app
│   ├── api/
│   │   ├── client.ts
│   │   ├── errors.ts
│   │   └── schema.ts           # generated
│   ├── auth/
│   │   ├── storage.ts          # secure token storage
│   │   └── flow.ts             # login UI logic
│   ├── db/
│   │   ├── index.ts            # connection
│   │   ├── bus.ts              # change notifications
│   │   ├── migrations/
│   │   │   └── 001_initial.sql
│   │   ├── tasks.ts            # repository
│   │   ├── projects.ts
│   │   └── labels.ts
│   ├── domain/
│   │   ├── task.ts             # domain types + zod schemas
│   │   ├── project.ts
│   │   └── label.ts
│   ├── sync/
│   │   ├── engine.ts           # scheduler
│   │   ├── push.ts             # outbox drain
│   │   ├── pull.ts             # delta fetch
│   │   ├── reconcile.ts        # deletion sweep
│   │   ├── conflict.ts         # resolution logic
│   │   └── mapping.ts          # local <-> server ID
│   ├── queries/                # TanStack Query hooks
│   │   ├── tasks.ts
│   │   ├── projects.ts
│   │   └── ...
│   ├── stores/                 # Zustand stores
│   │   ├── ui.ts
│   │   └── sync.ts
│   ├── features/               # feature folders, each self-contained
│   │   ├── task-list/
│   │   ├── task-detail/
│   │   ├── project-sidebar/
│   │   ├── quick-add/
│   │   ├── kanban/
│   │   ├── settings/
│   │   └── login/
│   ├── lib/                    # shared utilities
│   │   ├── parsers/            # natural language date, quick-add syntax
│   │   ├── date.ts
│   │   └── shortcuts.ts
│   ├── components/             # shadcn/ui primitives + shared components
│   ├── styles/
│   │   └── globals.css
│   ├── App.tsx
│   ├── main.tsx
│   └── routes.tsx              # TanStack Router config
├── tests/
│   ├── unit/                   # Vitest
│   │   └── sync.test.ts
│   └── e2e/                    # Playwright
│       └── quick-add.spec.ts
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

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

## 14. Implementation Phases

### Phase 0 — Skeleton (1 week)

- Tauri + Vite + React + Tailwind boilerplate
- SQLite plugin wired up with initial migration
- Login screen accepting server URL + API token
- Hit `/api/v1/user`, store result, render "logged in as X"

### Phase 1 — Read-only sync (2 weeks)

- Generated API types
- Repositories for projects, tasks, labels (read paths only)
- Pull loop: full initial sync, then delta polling
- Three-pane UI shell, project sidebar, task list view
- Detail pane (read-only)

### Phase 2 — Local writes + outbox (2 weeks)

- Outbox table + push loop
- Create/edit/delete tasks locally
- ID mapping
- Optimistic UI throughout
- Offline indicator

### Phase 3 — Conflict resolution + deletion sweep (1 week)

- `_lastSynced` snapshot column
- Conflict detection + resolution UI
- Periodic deletion reconciliation

### Phase 4 — Polish & native integration (2 weeks)

- Quick add with parser
- Global shortcuts
- Notifications (due reminders)
- Tray icon
- Autostart
- Deep links
- Auto-updater

### Phase 5 — Views beyond list (2 weeks)

- Kanban
- Table view
- Saved filters
- Search (FTS5)

### Phase 6 — Stretch

- Attachments (download, cache, upload)
- Comments + @mentions
- Gantt
- Time tracking (if Vikunja adds it server-side)

Realistic solo dev timeline: ~3 months to a daily-driver v1.

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
