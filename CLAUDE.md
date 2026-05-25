# Working notes for Claude

This is **Cria** — a native desktop client for Vikunja. Read [SPEC.md](SPEC.md)
first for the design; this file captures *implementation* state and gotchas a
fresh session needs.

## Current state

- **M0 done** (commit `b6dd56b`). App boots, login screen accepts a Vikunja URL
  + API token, fetches `/api/v1/user`, persists locally, lands on a
  "Signed in as X" screen that survives relaunch.
- **M1 next** (read-only sync of projects/labels/tasks → three-pane UI).

Milestones are M0..M6 (see SPEC §14). Commit at each milestone boundary.

## Stack at a glance

- Shell: Tauri 2 (Rust in `src-tauri/`)
- Frontend: React 18 + Vite + Tailwind v4
- State: Zustand (UI) + TanStack Query (server cache backed by the local DB)
- Local DB: `@tauri-apps/plugin-sql` (SQLite); schema in
  [src/db/migrations/001_initial.sql](src/db/migrations/001_initial.sql) —
  already includes projects/tasks/labels/outbox/sync_state/conflicts. M1+
  only needs repositories and queries, not new migrations (unless schema
  changes).
- API: `openapi-fetch` against a hand-written
  [schema.ts](src/api/schema.ts) stub. Run `pnpm generate:api` (with
  `VK_URL=https://todo.j-w.dev` or similar) to regenerate from the real
  OpenAPI doc when starting M1.
- Tests: Vitest (unit), no e2e yet.

## Gotchas you'll hit

### Tauri SQL plugin requires explicit `sql:allow-execute`

`sql:default` allows `select` and `load` but **not** `execute`. Without
`sql:allow-execute` in [`capabilities/default.json`](src-tauri/capabilities/default.json),
every write throws *"sql.execute not allowed"* with no visible failure path
unless you surface the error. M0 burned an hour on this. Already fixed —
just don't strip it.

### Capabilities are compile-time

Editing `src-tauri/capabilities/*.json` requires a Rust rebuild. Restart
`tauri dev` (≈10s for an incremental rebuild of the `cria` crate).

### Stronghold is too slow for credential storage

Stronghold's `load` and `save` took **minutes** per call on the dev machine.
We use `localStorage` instead ([src/auth/storage.ts](src/auth/storage.ts)).
The plugin is still registered in [lib.rs](src-tauri/src/lib.rs) for future
secret-storage needs but is not on any hot path.

Threat model: identical to what SPEC §15 already accepts for the SQLite db
("rely on OS-level disk encryption + per-user filesystem perms").
M4 upgrade path: swap in OS keychain via `keyring-rs` so the app data dir
alone is useless.

### pnpm 11 build-script approvals

`esbuild` needs build approval. We allowlist it via
[`pnpm-workspace.yaml`](pnpm-workspace.yaml) (`allowBuilds`) +
`package.json#pnpm.onlyBuiltDependencies`. Don't strip either file. If you
add a dep that ships native binaries, you may need to add it there too.

### `pnpm dev` indirectly requires `cargo`

`pnpm dev` → `tauri dev` → `cargo metadata`. If a fresh shell can't find
cargo, `source "$HOME/.cargo/env"` (or open a new tab — rustup added itself
to `~/.zshrc`).

## Conventions

### File layout

Already matches SPEC §11. Feature folders under `src/features/`, repositories
under `src/db/`, sync engine code (M2+) goes under `src/sync/`. Don't
restructure without reason.

### Writes go through repositories

UI components never touch SQL. They call repository functions in `src/db/*.ts`
which (a) do the SQL, (b) call `notify(topic)` from
[src/db/bus.ts](src/db/bus.ts). TanStack Query invalidates on bus events
(see [src/queries/user.ts](src/queries/user.ts) for the pattern).

### Sync metadata columns

Every syncable table has `updated_at`, `synced_at`, `last_synced`, `dirty`,
`deleted`. M1 only reads (so just populate from server). M2 introduces
local writes that flip `dirty=1` + push an outbox row.

### Local UUIDs, optional server IDs

`local_id` is a `nanoid()` UUID generated client-side. `server_id` is `NULL`
until first successful sync. Foreign keys reference `local_id` so offline
creates work. See SPEC §4.2.

### Vikunja's verb semantics

`GET = read`, **`PUT = create`**, **`POST = update`**, `DELETE = delete`.
Non-standard but baked into Vikunja's API. The generated types will reflect
this; don't try to "fix" them.

## Quick local commands

```sh
pnpm dev                 # tauri dev (full stack with HMR)
pnpm vite                # frontend only, no Tauri shell (good for UI iteration)
node_modules/.bin/tsc --noEmit       # type-check
node_modules/.bin/vitest run         # unit tests
node_modules/.bin/vite build         # production frontend build
cargo check --manifest-path src-tauri/Cargo.toml   # Rust shell sanity
```

(Going through `node_modules/.bin/` directly skips pnpm's pre-flight if it
complains about build-script approvals.)

## User preferences observed

- Wants tight, low-noise updates between tool calls. End-of-turn summaries
  one or two sentences.
- Wants commits at milestone boundaries, not mid-feature.
- "Don't add features beyond what the task requires" — keep M1's scope tight
  to read-only sync.
