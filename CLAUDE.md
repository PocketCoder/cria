# Working notes for Claude

This is **Cria** — a native desktop client for Vikunja. Read [SPEC.md](SPEC.md)
first for the design; this file captures *implementation* state and gotchas a
fresh session needs.

## Current state

- **M0 done** (commit `b6dd56b`). Sign-in works, creds persist, relaunch lands on the shell.
- **M1 done** (commit `cdbae21`). Projects + tasks sync from server, render in a
  three-pane shell, refresh every 60s and on window focus.
- **M2 done** (commit `eb84f71`). Create/update/delete tasks locally; outbox
  drains to the server (PUT/POST/DELETE) and the UI updates live. Verified
  end-to-end against a self-hosted instance.
- **M3 partial**. Conflict detection + modal + deletion reconciliation are
  in tree. **Not formally smoke-tested** against a two-client scenario after
  the M2 concurrency rewrite — worth a force-conflict test before declaring
  M3 done.
- **M4 done** (commit `83e8864` + follow-ups). Notification / autostart /
  global-shortcut / tray plugins wired; Rust-side `execute_tx` command for
  atomic transactions; alpaca app + tray icons.
- **M4.5 done** (merge `fd2fb5b` + release-pipeline fixes `df85933`
  and `7c0c228`). `tauri-plugin-updater` + `plugin-process` wired,
  Ed25519 signing keypair generated, GitHub Actions release workflow
  publishes signed bundles for macOS aarch64 + x86_64 plus
  `update.json` to the `gh-pages` branch. First release
  `v0.1.0-alpha` shipped end-to-end; running builds see the banner
  and `installUpdate()` works.
- **M5 done** (shipped in `v0.3.0`). TipTap WYSIWYG editor (slash-commands
  + underline), TaskActions sidebar (priority/progress/color/move/duplicate/
  favorite/subscribe/repeat/assignees), inline title editing in list + detail,
  full label model + sync + chip rendering + toggle outbox path, external
  links via plugin-opener, **and** the natural-language quick-add parser
  ([src/lib/quickAddParser.ts](src/lib/quickAddParser.ts), wired into the
  TaskList add-input + the global Cmd+Shift+A modal, with a token-coloured
  live preview). This hits the daily-driver bar (M0–M5).
- **Versioning is plain `0.x.y`** (no `-alpha`/`-beta` — the `0.` major is
  the stability signal; `1.0.0` is the "stable, won't break your data"
  promise). Minor per milestone, patch for fixes. See [SPEC.md §14
  "Versioning policy" + "Release schedule"](SPEC.md). Next up: M6 (Today /
  Upcoming / Inbox smart views + FTS5 search) → `v0.4.0`, the headline
  Todoist-parity unlock. Open papercut issues: #19/#20/#21/#25 ship in
  `v0.3.0`; #26 (header overlap) → `v0.3.1`.

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

### `withTx` is a *batched* transaction — don't read collected writes inside

`@tauri-apps/plugin-sql` v2.x wraps `sqlx::Pool<Sqlite>` with the default
**10-connection pool** (see `tauri-plugin-sql-<ver>/src/wrapper.rs::execute`).
Every `db.execute()` call from JS acquires a fresh connection, so
JS-issued `BEGIN`/`COMMIT` lands on different connections and breaks.

The fix lives in [src-tauri/src/tx.rs](src-tauri/src/tx.rs): a custom Tauri
command `execute_tx` that pins one connection from the pool, runs all
supplied statements inside `sqlx::Transaction`, commits (or rolls back
on error). [src/db/index.ts](src/db/index.ts)'s `withTx` collects the
callback's `db.execute()` calls into a batch, then invokes `execute_tx`
once when the callback resolves.

**Consequences for callers:**
- Inside the callback, `db.execute(sql, params)` does **not run
  immediately** — it just appends to the pending batch. The returned
  `ExecuteResult` is a placeholder (`rowsAffected: 0`, `lastInsertId: 0`).
- `db.select(sql, params)` does run immediately (pass-through), but it
  reads **pre-batch** state. Any SELECT meant to see a value written
  earlier in the same `withTx` callback will miss it.
- **Pattern:** SELECT-then-write is fine; write-then-SELECT-of-the-same-row
  must move the SELECT outside the callback (after `withTx` resolves).
  See [`createTask` / `updateTask`](src/db/tasks.ts) for the layout.

Other primitives in `db/index.ts`:
- `serial(fn)` — queue an async function behind all in-flight writes.
- `exec(sql, params)` — single-statement write queued via `serial`. Faster
  than `withTx` for one-statement writes; doesn't need a real tx.

**Never write `db.execute('BEGIN')` (or COMMIT/ROLLBACK) directly from JS.**
Those statements would still land on whichever pool connection sqlx hands
out; the dangling-tx cascade from before would return.

Globals also matter here:
- `globalThis.__cria_writeChain__` — the serial queue's tail. Pinned so
  Vite HMR can't reset it while transactions are in flight.
- `globalThis.__cria_busListeners__` — change-bus listeners map. Same
  reason: HMR re-loads `bus.ts` and would otherwise orphan subscribers.
- `globalThis.__cria_isDraining__` — outbox drain re-entry guard.

If you re-introduce a module-local `let foo = …` for any of these, the
HMR-orphan bug returns.

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

### Branching

All development happens on the `dev` branch. Feature work uses `feature/<name>`
branches, bug fixes use `fix/<name>` branches. PRs target `dev`; `main` is
released only. Always branch off `dev`, never off `main`.

### File layout

Already matches SPEC §11. Feature folders under `src/features/`, repositories
under `src/db/`, sync engine under `src/sync/`, domain types/zod under
`src/domain/`. Don't restructure without reason.

### Sync vs user mutations

| Concern | Sync path | User path |
|---|---|---|
| Function name | `upsertXFromServer` | `createX`, `updateX`, `deleteX` |
| Caller | pull loop / queryFn | UI mutation handler |
| `dirty` column | always `0` | set to `1` |
| Outbox entry | no | yes |
| `notify(...)` | **never** (infinite loop) | **always** |

Sync upserts must also **respect a pending local delete** (`dirty=1 &&
deleted=1`) and skip overwriting the row — otherwise the pull resets
`deleted=0` and the task flickers back into the UI until the outbox push
catches up. See the guard in
[`src/db/tasks.ts` upsertTaskFromServer](src/db/tasks.ts).

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

## Running a dev build side-by-side with the release

Two builds, two bundle IDs, two macOS data dirs. No cross-talk.

| | `Cria.app` (release) | `Cria Dev.app` (dev) |
|---|---|---|
| Branch | `main` (auto-updates) | `dev` (manual rebuild) |
| Bundle ID | `io.cria.desktop` | `io.cria.desktop.dev` |
| Data dir | `~/Library/Application Support/io.cria.desktop` | `~/Library/Application Support/io.cria.desktop.dev` |
| SQLite | separate | separate |
| localStorage | separate (per-bundle webview) | separate |
| Updater | `https://pocketcoder.github.io/cria/update.json` | disabled (endpoints point at an invalid host so the check fails silently — `src/queries/updater.ts` already swallows the error) |

Build the dev one with the overlay config:

```sh
pnpm build:dev-app
# outputs src-tauri/target/release/bundle/dmg/Cria Dev_<ver>_<arch>.dmg
```

Drag the resulting `.dmg` into `/Applications`. Re-run the build to refresh
it. The overlay lives in [`src-tauri/tauri.dev.conf.json`](src-tauri/tauri.dev.conf.json) —
only the fields that need to differ (productName, identifier, updater
endpoints, updater-artifact flag); everything else inherits from
`tauri.conf.json`.

### Two-client behaviour with one Vikunja account

Both apps will be talking to the same server with the same credentials.
That's fine — but it means *every* edit you make in one app eventually
shows up in the other, with up to ~60 s of pull lag. If you happen to
edit the same task in both within that window, whichever pulls second
will surface the conflict modal. Not a bug — that's the M3 conflict
path firing naturally. (Free smoke test, in fact.)

Outbox counts are per-app: each one shows only its own pending
mutations.

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

## M3 — still owed

Two-client manual smoke test (force a conflict by editing the same task in
the web UI and in Cria within the ~60 s pull window, then check the conflict
modal fires and resolves cleanly). Hard to repro because sync drains too
fast to diverge; tracked in #32. Automated dirty-guard + field-merge
coverage already lives in `tests/unit/syncMerge.test.ts` +
`tests/unit/upsertFromServer.test.ts`.

## M4.5 — auto-updater (done; first shipped under `v0.1.0-alpha`, current under plain `0.x.y`)

Wired in `tauri-plugin-updater` + `tauri-plugin-process`. Ed25519
signing keypair lives at `~/.tauri/cria-update.key` on the dev box;
public key is in `src-tauri/tauri.conf.json` under
`plugins.updater.pubkey`, private is the `TAURI_SIGNING_PRIVATE_KEY`
GitHub Actions secret.

### Frontend
- `src/tauri/updater.ts` — `checkForUpdate()` / `installUpdate()` wrapper.
- `src/queries/updater.ts` — `useUpdater()` state machine with one
  silent check on mount; expose `runCheck` for a future "Check for
  updates" settings button.
- `src/features/shell/UpdateBanner.tsx` — footer pill, only renders
  when an update is `available` or `installing`.

### Release pipeline (`.github/workflows/release.yml`)
- Trigger: any `v*` tag push on any branch (tags are branch-agnostic;
  lock to main with `if: contains(github.event.base_ref, 'main')` if
  desired later).
- Builds: macOS `aarch64-apple-darwin` + `x86_64-apple-darwin`.
- `tauri build --bundles app,dmg,updater` + `createUpdaterArtifacts: true`
  in `tauri.conf.json` are both required to emit the `.app.tar.gz` +
  `.sig` the updater verifies. Don't drop either.
- Per-target updater bundles renamed to `Cria_<arch>.app.tar.gz{,.sig}`
  in the staging step — otherwise both matrix jobs flatten to the same
  `Cria.app.tar.gz` and the second overwrites the first.
- `update.json` published to the `gh-pages` branch by
  `peaceiris/actions-gh-pages`; served at
  `https://pocketcoder.github.io/cria/update.json`.

### Cutting a release

```sh
# from any branch with the workflow file
git tag vX.Y.Z(-suffix) && git push origin vX.Y.Z(-suffix)
```

Bump `version` in all three places before tagging:
- `package.json` (frontend / footer label)
- `src-tauri/tauri.conf.json` (what Tauri bundles + the updater
  compares against)
- `src-tauri/Cargo.toml` (Rust crate version — cosmetic in terms of
  what users see, but keep it in sync so `cargo metadata` and the
  Cargo.lock line agree with everything else)

Then re-run `cargo check --manifest-path src-tauri/Cargo.toml` once
so `Cargo.lock` picks up the new version line.

### Not in scope

- Windows / Linux builds — matrix is macOS-only. Add `windows-latest`
  + `ubuntu-latest` rows when there's demand.
- Apple notarisation — we sign the *updater bundle* (sufficient for
  Tauri's updater check) but the DMG itself isn't notarised. First
  launch will trip macOS's "unidentified developer" warning. M10.
- Per-platform release notes — manifest just links back to the GitHub
  Release page.

