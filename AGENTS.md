# Cria — agent guide

**Cria** is a native desktop and iOS client for [Vikunja](https://vikunja.io),
built with Tauri 2 + React. Read [SPEC.md](SPEC.md) for the *design*; this file is
the *implementation* cheat-sheet — commands, conventions, and the hard-won
gotchas a fresh session needs before touching code.

> This file is `AGENTS.md` (the cross-tool convention). Claude Code loads it
> automatically when no `CLAUDE.md` is present. Keep it as the single source
> of agent context — don't re-add a `CLAUDE.md` or the two will diverge.

## Commands

```sh
pnpm dev            # full Tauri stack (needs cargo on PATH — see gotcha)
pnpm vite           # frontend only, no webview
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run (unit tests in tests/unit/)
pnpm test:watch     # vitest watch
pnpm vite:build     # production frontend build
pnpm generate:api   # regen src/api/schema.ts (VK_URL= to target an instance)
pnpm clean          # rm -rf dist src-tauri/target (reclaim ~7GB build artifacts)
pnpm clean:all      # also rm -rf node_modules (needs pnpm install before next dev)
cargo check --manifest-path src-tauri/Cargo.toml   # Rust shell sanity
pnpm tauri ios dev --host           # run on a connected iOS device / simulator
pnpm tauri ios build --export-method debugging   # standalone signed iOS build
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios   # iOS shell compile-check
```

If pnpm's build-script pre-flight nags, the same binaries live under
`node_modules/.bin/` (`node_modules/.bin/tsc --noEmit`, `…/vitest run`,
`…/vite build`) and skip the check.

**Always** run `pnpm typecheck` and `pnpm test` before declaring a change
done. Touching Rust or `src-tauri/capabilities/*` → also `cargo check` (and
`cargo check --target aarch64-apple-ios` to catch iOS-only breakage).

## Current state

Daily-driver bar (M0–M5) is **met**; M6 (smart views + FTS5 search)
shipped in `v0.4.0`. Current version is `0.12.6` (in `package.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` + `Cargo.lock` —
keep all in sync). **Bump only via `pnpm bump` (see "Cutting a
release") — never hand-edit these files.** This has bitten twice:
`v0.4.0`/`v0.4.1` were tagged without bumping (stuck at `0.3.1`), and
`v0.12.5` bumped only `package.json` (Tauri/Cargo stuck at `0.12.4`).
Both times the running build reported the wrong version and the updater
offered a perpetual update. `pnpm bump` touches all four at once.

| Milestone | Status |
|---|---|
| M0 skeleton + sign-in | ✅ |
| M1 read-only sync (projects/tasks/labels, 60s refresh) | ✅ |
| M2 local writes + outbox (create/update/delete round-trip) | ✅ |
| M3 conflicts + deletion reconcile | 🟡 in tree; one owed item below |
| M4 native polish (notification/autostart/global-shortcut/tray, `execute_tx`) | ✅ |
| M4.5 auto-update distribution (updater, signing, release workflow) | ✅ |
| M5 input parity (TipTap WYSIWYG, NL quick-add, inline pickers, label mutations) | ✅ |
| M6 smart views (Today / Upcoming / Inbox) + saved filters + FTS5 search | ✅ |
| M7 command palette (Cmd+K) | ✅ |
| M8 hierarchy, recurrence, reminders | ✅ Hierarchy, recurrence, reminders, related tasks |
| M9 reorder, DnD, Kanban, table view | ✅ |
| M10 stretch — attachments, comments, Gantt, notes | ✅ attachments, Gantt; ✅ comments (full read/write + reactions); 🟡 notes pending |
| **iOS** — desktop-feature gating, responsive iPhone layout, touch DnD, OS-scheduled reminders, perf pass, CI compile-check | ✅ |

**Next up:** M10 stretch goals (notes).
See [SPEC.md §14](SPEC.md).

**Known gaps / deferred:**
- **M3 two-client conflict smoke test** still owed (#32) — hard to repro
  because sync drains too fast to diverge. Automated dirty-guard + merge
  coverage already lives in `tests/unit/syncMerge.test.ts` +
  `tests/unit/upsertFromServer.test.ts`.
- **Delta-aware pull** — `src/sync/pull.ts` still does a full per-project
  reload each tick (filters by `project_id`, not `updated > lastSyncAt`).
  Fine for a few projects; revisit if it gets slow.

## Stack

- **Shell:** Tauri 2 (Rust in `src-tauri/`)
- **Frontend:** React 18 + Vite + Tailwind v4
- **State:** Zustand (UI + auth) + TanStack Query (server cache backed by the
  local DB). No router yet — single shell view, navigation is Zustand state.
- **Local DB:** `@tauri-apps/plugin-sql` (SQLite). 15 migrations in
  `src/db/migrations/` (`001_initial.sql` → `015_perf_indexes.sql`).
  Forward-only; registered in [src-tauri/src/lib.rs](src-tauri/src/lib.rs).
  Never edit a shipped migration.
- **API:** `openapi-fetch` against [src/api/schema.ts](src/api/schema.ts),
  generated from Vikunja's docs (Swagger 2 → OpenAPI 3 via `swagger2openapi`).
  Calls route through the Tauri HTTP plugin to dodge CORS.

## Architecture in one paragraph

UI reads via TanStack Query hooks in `src/queries/*`. Hooks call repositories
in `src/db/*` for cached reads and `src/sync/pull.ts` for server fetches. The
sync layer validates server payloads with Zod schemas in `src/domain/*`, then
upserts via repository helpers (`upsert*FromServer`). After the pull, the
queryFn re-reads from the DB so the consumer gets fresh data. Writes go to the
DB + an outbox row in one transaction; `src/sync/push.ts` drains the outbox
FIFO to the server with exponential backoff.

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

Stronghold's `load`/`save` took **minutes** per call on the dev machine. We
use `localStorage` instead ([src/auth/storage.ts](src/auth/storage.ts)). The
plugin stays registered in [lib.rs](src-tauri/src/lib.rs) for future
non-hot-path uses. Threat model documented inline in `storage.ts`. Future
upgrade path: OS keychain via `keyring-rs`.

### `withTx` is a *batched* transaction — don't read collected writes inside

`@tauri-apps/plugin-sql` v2.x wraps `sqlx::Pool<Sqlite>` with the default
**10-connection pool**. Every `db.execute()` call from JS acquires a fresh
connection, so JS-issued `BEGIN`/`COMMIT` lands on different connections and
breaks.

The fix lives in [src-tauri/src/tx.rs](src-tauri/src/tx.rs): a custom Tauri
command `execute_tx` that pins one connection, runs all supplied statements
inside `sqlx::Transaction`, commits (or rolls back on error).
[src/db/index.ts](src/db/index.ts)'s `withTx` collects the callback's
`db.execute()` calls into a batch, then invokes `execute_tx` once when the
callback resolves.

**Consequences for callers:**
- Inside the callback, `db.execute(sql, params)` does **not run immediately**
  — it appends to the pending batch. The returned `ExecuteResult` is a
  placeholder (`rowsAffected: 0`, `lastInsertId: 0`).
- `db.select(sql, params)` runs immediately (pass-through) but reads
  **pre-batch** state. A SELECT meant to see a value written earlier in the
  same `withTx` callback will miss it.
- **Pattern:** SELECT-then-write is fine; write-then-SELECT-of-the-same-row
  must move the SELECT *outside* the callback (after `withTx` resolves). See
  [`createTask` / `updateTask`](src/db/tasks.ts) for the layout.

Other primitives in `db/index.ts`:
- `serial(fn)` — queue an async function behind all in-flight writes.
- `exec(sql, params)` — single-statement write queued via `serial`. Faster
  than `withTx` for one-statement writes; no real tx needed.

**Never write `db.execute('BEGIN')` (or COMMIT/ROLLBACK) directly from JS** —
those land on whichever pool connection sqlx hands out and the dangling-tx
cascade returns.

Globals matter here too (pinned so Vite HMR can't reset them mid-flight):
- `globalThis.__cria_writeChain__` — the serial queue's tail.
- `globalThis.__cria_busListeners__` — change-bus listeners map.
- `globalThis.__cria_isDraining__` — outbox drain re-entry guard.

Re-introduce a module-local `let foo = …` for any of these and the HMR-orphan
bug returns.

### Sync-path upserts MUST NOT call `notify()`

The biggest sync footgun. `upsertXFromServer()` runs inside the pull → inside
the queryFn that *owns* the query. If it calls `notify('tasks')`, the bus
subscription invalidates that same in-flight query → queues a refetch →
another pull → another notify → infinite loop. The "syncing…" indicator
sticks forever and the UI starves.

**Rule:** sync upserts are silent. User-driven mutations live in *different*
functions that *do* call `notify()`. See the inline comments in
[src/db/projects.ts](src/db/projects.ts) and [src/db/tasks.ts](src/db/tasks.ts).

### Vikunja's verb semantics

`GET = read`, **`PUT = create`**, **`POST = update`**, `DELETE = delete`.
Non-standard but baked into Vikunja's API. The generated types reflect this;
don't try to "fix" them.

### Vikunja `/tasks` rejects `sort_by=position`

`sort_by=position` returns **HTTP 400** outside a view context — positions are
per-view-only. We sort locally (`listTasksForProject` ORDER BY) and pass no
`sort_by` to the API. Same likely applies to other view-scoped fields; verify
before adding new `sort_by` values. (Bit drag-to-reorder in M9 — handled by local ORDER BY.)

### Vikunja "no date" sentinel

The server serialises missing timestamps as `"0001-01-01T00:00:00Z"`.
[src/domain/task.ts](src/domain/task.ts)'s `normaliseDate()` maps it to `null`
on the way in. Don't display the raw value.

### `taskToBody()` wire-format quirks

Every Vikunja server-side body quirk lives in `taskToBody()` in
[src/sync/push.ts](src/sync/push.ts): `hex_color` sent raw (no `#`, else 500),
`percent_done` as 0–100 (UI stores 0–1), `is_favorite` sent explicit `false`
(omitting breaks un-favorite), `repeat_after`/`repeat_mode` sent explicit `0`,
`project_id` included on move. Covered by `tests/unit/taskToBody.test.ts`.

### Vikunja settings POSTs are full-object replaces (silent data loss)

`POST /user/settings/general` does **not** patch. Its handler copies *every*
field of the request body onto the user record and saves with
`forceOverride=true`, so any field you omit is written back as its Go zero
value (`""`, `0`, `false`, `nil`) — silently wiping the server's stored `name`,
`default_project_id`, `week_start`, language/timezone, and reminder flags. The
generated `schema.ts` only shows the body *shape* (a complete `v1.UserSettings`);
the Go handler is the ground truth (`pkg/routes/api/v1/user_settings.go`,
`UpdateGeneralUserSettings`). When upstream runtime behaviour is in doubt, read
the handler — a local clone of the Vikunja source makes this checkable in
seconds and beats inferring from the schema.

**Rule:** never send a partial settings object. Seed the complete current
settings (`user.raw.settings`), merge your one change on top, then POST the
whole thing. [`SettingsModal`](src/components/SettingsModal.tsx)'s `settingsRef`
+ `pushSettings()` wrapper is the reference pattern; `UserSettingsInput` carries
even the non-UI fields (`default_project_id`, discoverability,
`frontend_settings`) purely so they round-trip untouched. Assume any other
"update the whole entity" POST behaves the same — read the handler before
sending a subset.

### pnpm 11 build-script approvals

`esbuild` + `better-sqlite3` need build approval. Allowlisted in
[pnpm-workspace.yaml](pnpm-workspace.yaml) (`allowBuilds`) +
`package.json#pnpm.onlyBuiltDependencies`. Don't strip either. New deps with
native binaries may need adding too.

### `pnpm dev` indirectly requires `cargo`

`pnpm dev` → `tauri dev` → `cargo metadata`. If a fresh shell can't find
cargo, `source "$HOME/.cargo/env"` (or open a new tab — rustup added itself to
`~/.zshrc`).

## Conventions

### Branching

All development happens on `dev`. Feature work uses `feature/<name>` branches,
fixes use `fix/<name>`. PRs target `dev`; `main` is released-only. Always
branch off `dev`, never off `main`.

### iOS & platform gating

Cria builds for iOS from the same codebase. Two distinct "is this mobile?"
checks — **don't conflate them**:

- **`isMobilePlatform()`** ([src/lib/platform.ts](src/lib/platform.ts)) —
  *capability* gating (the OS). Resolved once at boot from
  `@tauri-apps/plugin-os`; a cheap sync read elsewhere, defaults to desktop.
  Use it to no-op desktop-only features on iOS.
- **`useIsMobile()`** ([src/lib/useIsMobile.ts](src/lib/useIsMobile.ts)) —
  *layout* breakpoint (viewport ≤768px) for the responsive shell. A narrow
  desktop window is "mobile" here but not for capabilities.

Other rules:
- **Capabilities are split by platform.** Shared perms (sql, http,
  notification, deep-link, os) live in
  [`capabilities/default.json`](src-tauri/capabilities/default.json) (no
  `platforms` key → all platforms). Desktop-only perms (global-shortcut,
  autostart, updater, process) live in
  [`capabilities/desktop.json`](src-tauri/capabilities/desktop.json) with
  `"platforms": ["macOS","windows","linux"]` — those plugins aren't compiled
  on iOS, so listing them on mobile breaks the build.
- **Desktop-only plugins are gated Rust-side** with `#[cfg(desktop)]` in
  [lib.rs](src-tauri/src/lib.rs) and no-op'd in the `src/tauri/` JS wrappers
  via `isMobilePlatform()`.
- **Reminders differ by platform**
  ([src/sync/useReminderScheduler.ts](src/sync/useReminderScheduler.ts)):
  desktop polls + fires immediately while running; mobile hands future
  reminders to the OS via the notification plugin's `Schedule.at` so they fire
  when the app is closed, reconciling local reminders against the OS pending
  list (see the `notification.ts` wrapper).
- **Background timers pause on mobile** via
  [`isPageVisible()`](src/lib/visibility.ts) (periodic-sync + reminder loops),
  so they don't drain battery in the background; they resume on
  `visibilitychange`.
- **iOS dev quirks:** `tauri ios dev --host` serves Vite over the LAN (device
  needs Local Network permission); after install, trust the dev profile in
  Settings → General → VPN & Device Management; the home-screen icon caches
  hard (delete app + reboot if it shows the default). CI compile-checks the iOS
  shell on native-code changes
  ([.github/workflows/ci-ios.yml](.github/workflows/ci-ios.yml)); signed
  distribution is manual (no paid Apple account yet — see release.yml).

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
catches up. The central guard lives in `src/db/syncMerge.ts`
(`mergeFromServer`).

### Local UUIDs, optional server IDs

`local_id` is a client-side `nanoid()`. `server_id` is `NULL` until first
successful sync. Foreign keys reference `local_id` so offline creates work.
See SPEC §4.2.

### Sync metadata columns

Every syncable table has `updated_at`, `synced_at`, `last_synced`, `dirty`,
`deleted`. Sync reads keep `dirty=0`; local writes flip `dirty=1` + push an
outbox row. `last_synced` (JSON snapshot) feeds conflict detection.

### File layout

Matches SPEC §11. Feature folders under `src/features/`, repositories under
`src/db/`, sync engine under `src/sync/`, domain types/zod under
`src/domain/`. Don't restructure without reason.

### Settings & preferences

All client preferences live in one Zustand `persist` store
([src/stores/settings.ts](src/stores/settings.ts), key `cria:settings/v2`).
Bump that key only alongside a migration — a bare rename silently resets every
persisted preference to its default. Server-backed prefs (language, timezone,
week start, name, reminders) also sync through `pushUserSettings` — which is
full-object, see the gotcha above.

**A setting isn't done until something reads it.** A persisted/synced toggle
with no consumer looks like it works but does nothing — that's a bug, not a
half-feature. Before adding a control to `SettingsModal`, grep for a reader of
the new `useSettings` field and wire the value into the code that should honour
it. Seed effects that read async query data (e.g. the server `user`) must
depend on that data, not run once on `[]` mount — otherwise they fire before
the data loads and never re-run. If wiring is genuinely out of scope, ship the
control as 🟡 in FEATURE-COMPARISON.md, never ✅.

## Running a dev build side-by-side with the release

Two builds, two bundle IDs, two macOS data dirs. No cross-talk.

| | `Cria.app` (release) | `Cria Dev.app` (dev) |
|---|---|---|
| Branch | `main` (auto-updates) | `dev` (manual rebuild) |
| Bundle ID | `io.cria.desktop` | `io.cria.desktop.dev` |
| Data dir | `~/Library/Application Support/io.cria.desktop` | `…/io.cria.desktop.dev` |
| SQLite / localStorage | separate | separate |
| Updater | live `update.json` | disabled (invalid endpoint, error swallowed) |

```sh
pnpm dev            # HMR dev run, ALSO under io.cria.desktop.dev
pnpm build:dev-app  # → …/bundle/dmg/Cria Dev_<ver>_<arch>.dmg
```

Drag the `.dmg` into `/Applications`; re-run to refresh. The overlay
([`src-tauri/tauri.dev.conf.json`](src-tauri/tauri.dev.conf.json)) only
overrides productName / identifier / updater endpoints; everything else
inherits from `tauri.conf.json`.

**Why `pnpm dev` uses the dev identifier (don't revert this).** Migrations
are registered Rust-side and the plugin records applied versions in the
DB. If `pnpm dev` ran under the release identifier (`io.cria.desktop`,
the old default), running it from a branch with a *newer* migration would
upgrade the **installed release app's** database — and the older release
binary then aborts with `migration N … missing in the resolved
migrations`, bricking the shipped app's DB. Routing `pnpm dev` through
`tauri.dev.conf.json` (`io.cria.desktop.dev`) keeps dev's schema fully
isolated. `pnpm dev:release-id` is the escape hatch if you ever
deliberately need the release DB.

**Two-client note:** both apps hit the same server with the same credentials,
so an edit in one shows up in the other within ~60s of pull lag. Editing the
same task in both within that window surfaces the M3 conflict modal — a free
smoke test. Outbox counts are per-app.

## Cutting a release

Auto-update is wired (`tauri-plugin-updater` + `tauri-plugin-process`).
Ed25519 keypair: public key in `src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`), private key is the `TAURI_SIGNING_PRIVATE_KEY`
GitHub Actions secret. Manifest served at
`https://pocketcoder.github.io/cria/update.json` (gh-pages branch).

1. `pnpm bump <patch|minor|major|X.Y.Z>` — updates `package.json`,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and runs `cargo check`
   to sync `Cargo.lock`. (Script: `scripts/bump.sh`.)
3. `git tag vX.Y.Z && git push origin vX.Y.Z` — the `v*` tag triggers
   `.github/workflows/release.yml` (macOS aarch64 + x86_64, signs bundles,
   creates the GitHub Release, publishes `update.json`).
   **Push tags standalone** — `git push origin vX.Y.Z` only, never bundled
   with `git push origin dev --tags`. GitHub can drop the tag push event when
   branch and tag refs are sent in the same connection, leaving the release
   workflow untriggered.

**Versioning is plain `0.x.y`** — no `-alpha`/`-beta`. The `0.` major is the
stability signal; minor per milestone, patch for fixes. `1.0.0` is the
"stable, won't break your data" promise (maps to M7 polish + macOS
notarisation). See [SPEC.md §14](SPEC.md).

Release-pipeline landmines (don't undo):
- `--bundles app,dmg,updater` + `createUpdaterArtifacts: true` are both
  required to emit the `.app.tar.gz` + `.sig` the updater verifies.
- Per-target updater bundles are renamed to `Cria_<arch>.app.tar.gz{,.sig}`
  in the staging step — else both matrix jobs flatten to one filename and the
  second overwrites the first.

Not in scope: Windows/Linux builds (matrix is macOS-only), Apple notarisation
(DMG isn't notarised → first launch trips the "unidentified developer"
warning; revisit before 1.0).

## User preferences observed

- Tight, low-noise updates between tool calls. End-of-turn summaries one or
  two sentences.
- Commits at milestone boundaries; intra-milestone commits still small,
  self-contained, atomic.
- "Don't add features beyond what the task requires" — keep scope tight to the
  exit criteria. Defer nice-to-haves explicitly.
- Paste-back diagnostics over speculative fixes. When something hangs or
  fails, surface the actual error / network response rather than guessing.
