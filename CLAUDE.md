# Working notes for Claude

This is **Cria** — a native desktop client for Vikunja. Read [SPEC.md](SPEC.md)
first for the design; this file captures *implementation* state and gotchas a
fresh session needs.

## Current state

- **M0 done** (commit `b6dd56b`). Sign-in works, creds persist, relaunch lands on the shell.
- **M1 done** (HEAD `cdbae21`). Projects + tasks sync from server, render in a
  three-pane shell, refresh every 60s and on window focus. Usable as a
  read-only viewer offline after the first sync.
- **M2 next** — local writes + outbox.

**Deferred from M1** (exit criteria already met without them):
- Read-only detail pane (third column showing the selected task)
- Labels on tasks (chips + label sidebar)
- Search (FTS5)
- Delta-aware pull (currently full reload of projects each tick — fine for a
  few projects, replace with `updated > lastSyncAt` filter in M3 reconcile)

## Stack at a glance

- Shell: Tauri 2 (Rust in `src-tauri/`)
- Frontend: React 18 + Vite + Tailwind v4
- State: Zustand (UI + auth) + TanStack Query (server cache backed by the
  local DB)
- Local DB: `@tauri-apps/plugin-sql` (SQLite). Full v1 schema in
  [src/db/migrations/001_initial.sql](src/db/migrations/001_initial.sql).
  Already includes projects/tasks/labels/outbox/sync_state/conflicts — M2+
  only needs new repos/queries, not new migrations (unless schema changes).
- API: `openapi-fetch` against [schema.ts](src/api/schema.ts) generated from
  Vikunja's docs (Swagger 2 → OpenAPI 3 via `swagger2openapi`). Regenerate
  with `pnpm generate:api` (override `VK_URL=` env var to target your
  instance).

## Architecture in one paragraph

UI reads via TanStack Query hooks in `src/queries/*`. Hooks call repositories
in `src/db/*` for cached reads and `src/sync/pull.ts` for server fetches. The
sync layer validates server payloads with Zod schemas in `src/domain/*`,
then upserts via repository helpers (`upsert*FromServer`). After the pull,
the queryFn re-reads from the DB so the consumer gets fresh data.

## Gotchas you'll hit

### Tauri SQL plugin requires explicit `sql:allow-execute`

`sql:default` allows `select` and `load` but **not** `execute`. Without
`sql:allow-execute` in [`capabilities/default.json`](src-tauri/capabilities/default.json),
every JS-side write throws *"sql.execute not allowed"* with no obvious failure
path. M0 burned an hour on this. Already fixed — don't strip it.

### Capabilities are compile-time

Editing `src-tauri/capabilities/*.json` requires a Rust rebuild. Restart
`tauri dev` (≈10s for an incremental rebuild of the `cria` crate).

### Stronghold is too slow for the credential hot path

Stronghold's `load` and `save` took **minutes** per call on the dev machine.
We use `localStorage` instead ([src/auth/storage.ts](src/auth/storage.ts)).
The plugin is still registered in [lib.rs](src-tauri/src/lib.rs) for future
non-hot-path uses. Threat model documented inline in `storage.ts`. M4 upgrade
path: OS keychain via `keyring-rs`.

### Sync-path upserts MUST NOT call `notify()`

This is the biggest M1 footgun. Repositories have `upsertXFromServer()`
functions that are called from inside the pull → inside the queryFn that
*owns* the query. If they call `notify('tasks')` (etc.), the bus subscription
invalidates the same query whose queryFn is mid-pull → queues a refetch →
another pull → another notify → infinite loop. The "syncing…" indicator
sticks on forever and the UI starves.

**Rule:** sync upserts are silent. User-driven mutations (M2+ create/update/
delete) live in *different* functions that *do* call `notify()`. See the
inline comment in [src/db/projects.ts:113](src/db/projects.ts) and the
matching one in [src/db/tasks.ts](src/db/tasks.ts).

### Vikunja `/tasks` server-side ordering

`sort_by=position` returns **HTTP 400** outside a view context — positions
are per-view-only per the OpenAPI docs. We sort locally
(`listTasksForProject` ORDER BY) and pass no `sort_by` to the API.
Same probably applies to other view-scoped fields; verify before adding new
`sort_by` values.

### Vikunja "no date" sentinel

The server serialises missing timestamps as `"0001-01-01T00:00:00Z"`.
[src/domain/task.ts](src/domain/task.ts) has `normaliseDate()` that maps it
to `null` on the way in. Don't display the raw value.

### Vikunja's verb semantics (M2+)

`GET = read`, **`PUT = create`**, **`POST = update`**, `DELETE = delete`.
Non-standard but baked into Vikunja's API. The generated types reflect this;
don't try to "fix" them.

### pnpm 11 build-script approvals

`esbuild` needs build approval. Allowlisted in
[pnpm-workspace.yaml](pnpm-workspace.yaml) (`allowBuilds`) +
`package.json#pnpm.onlyBuiltDependencies`. Don't strip either file. New deps
with native binaries may need to be added too.

### `pnpm dev` indirectly requires `cargo`

`pnpm dev` → `tauri dev` → `cargo metadata`. If a fresh shell can't find
cargo, `source "$HOME/.cargo/env"` (or open a new tab — rustup added itself
to `~/.zshrc`).

## Conventions

### File layout

Already matches SPEC §11. Feature folders under `src/features/`, repositories
under `src/db/`, sync engine under `src/sync/`, domain types/zod under
`src/domain/`. Don't restructure without reason.

### Sync vs user mutations

| Concern | Sync path | User path (M2+) |
|---|---|---|
| Function name | `upsertXFromServer` | `createX`, `updateX`, `deleteX` |
| Caller | pull loop / queryFn | UI mutation handler |
| `dirty` column | always `0` | set to `1` |
| Outbox entry | no | yes |
| `notify(...)` | **never** (infinite loop) | **always** |

### Local UUIDs, optional server IDs

`local_id` is a `nanoid()` UUID generated client-side. `server_id` is `NULL`
until first successful sync. Foreign keys reference `local_id` so offline
creates work. See SPEC §4.2.

### Sync metadata columns

Every syncable table has `updated_at`, `synced_at`, `last_synced`, `dirty`,
`deleted`. M1 only reads from server (every row has `dirty=0`). M2 introduces
local writes that flip `dirty=1` + push an outbox row. M3 uses `last_synced`
(JSON snapshot) for conflict detection.

## Quick local commands

```sh
pnpm dev                                             # full stack
pnpm vite                                            # frontend only
pnpm generate:api                                    # regen src/api/schema.ts
VK_URL=https://your-vikunja pnpm generate:api        # regen from your instance
node_modules/.bin/tsc --noEmit                       # type-check
node_modules/.bin/vitest run                         # unit tests
node_modules/.bin/vite build                         # production frontend build
cargo check --manifest-path src-tauri/Cargo.toml     # Rust shell sanity
```

(Going through `node_modules/.bin/` skips pnpm's pre-flight if it complains
about build-script approvals.)

## User preferences observed

*(unchanged)*

- Wants tight, low-noise updates between tool calls. End-of-turn summaries
  one or two sentences.
- Wants commits at milestone boundaries; intra-milestone commits should still
  be small, self-contained, atomic.
- "Don't add features beyond what the task requires" — keep milestone scope
  tight to its exit criteria. Defer the nice-to-haves explicitly.
- Likes paste-back diagnostics over speculative fixes. When something hangs
  or fails, surface the actual error / network response rather than
  guessing.

## Commit log map

```
M0 ── b6dd56b  skeleton + sign-in
      5cc981e  handoff notes
M1 ── f7f1388  API types regenerated (Swagger 2 → OpenAPI 3 → TS)
      e5bab34  project domain + repo
      cc32219  project pull loop
      90a59a5  sidebar + shell
      0fce2ae  tasks slice (domain + repo + pull + list)
      937d043  periodic background sync
      3c98951  fix infinite refetch loop  ← read this before M2!
      cdbae21  drop sort_by=position
```

## Starting M2 (local writes + outbox)

Spec §5.2 + §7.1 has the design. Concrete first chunks:

1. `src/db/tasks.ts` → `createTask(input)`: nanoid local_id, INSERT with
   `dirty=1`, append outbox row, call `notify('tasks')` (now safe — user
   path), return the new Task. Wrap in `withTx` from
   [src/db/index.ts](src/db/index.ts).
2. Same for `updateTask`, `deleteTask` (soft delete: `deleted=1`,
   outbox `op='delete'`).
3. `src/sync/push.ts` — drain outbox FIFO, exponential backoff per row,
   move to `outbox_dead_letter` after 10 attempts.
4. ID mapping: when a create succeeds, set `server_id` on the row.
5. UI: inline create input + checkbox toggle wire to the new functions.
6. Offline indicator: status bar dot reading from `sync_state` + outbox
   count.

The schema is already there. The bus pattern flips: now `notify()` is
**required** on every write.

## Recent work (GPT-OSS-120B)

- Bumped app version to `0.0.0-alpha` (package.json, Vite define, UI footer).
- Fixed version display using runtime import of `package.json`.
- Added dev‑only `keydown` listener for `⌘+Shift+A` shortcut.
- Implemented dev mocks for outbox `create`, `update`, `delete` when `VK_URL` is not set, so outbox clears instantly in dev.
- Added console logs for `outboxCount` and `conflictCount` for debugging.
- Added “Clear outbox” dev‑only button in footer.
- Implemented Autostart stub with in‑memory state and dev‑only UI toggle (label shows On/Off).
- Created placeholder tray icons (`icon_idle.png`, `icon_sync.png`, `icon_conflict.png`) and ensured they are bundled.
- Added `TrayStatus` fallback UI badge.
- Added `global.d.ts` declaration for `__APP_VERSION__` (now unused but harmless).
- Updated Vite config to expose `__APP_VERSION__`.
- Fixed import path for `package.json` in `Shell.tsx`.
- Updated dev scripts and ports to avoid conflicts.

### Open / Stuck issues

- Real server sync (`VK_URL`) is still not configured; dev mocks bypass network calls, so production‑ready syncing has not been exercised.
- Autostart stub only logs actions; the real Tauri autostart plugin has not been tested.
- Placeholder tray icon PNGs are empty files; proper graphics are needed for production.
- Debug console logs in `Shell` may need removal before release.
- `src/global.d.ts` is now redundant after moving to runtime import; can be removed.

