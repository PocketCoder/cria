# Native Swift iOS port: work plan

Goal: a native SwiftUI iOS app with feature parity to the Tauri iOS build, sharing the same Vikunja server, SQLite schema and sync semantics. Desktop stays on Tauri.

## How to use this plan

- One section (`S-nn`) per agent session. Each is sized for roughly 1 to 3 hours.
- Branch: `feature/swift-ios` off `dev`. Commit per section. Do not touch the Tauri app except where a section says so.
- Every section ends with its **Done when** check. Do not start the next section until it passes.
- Port behaviour from the TypeScript source and its tests in `tests/unit/`. The TS code is the spec; port the tests first or alongside.
- Re-read the relevant AGENTS.md gotcha before each sync or data section. They apply unchanged.
- Update the status table at the bottom as sections complete.
- **Models:** every section is built by Haiku 5.5 (native Claude, counts toward the Team limits). No Opus in routines: the user runs Opus reviews manually, weekly when remembered. If Haiku fails a section twice, mark it `blocked` for that review.
- **Cadence:** nightly, 1 to 2 sections per night.

## Ground rules (carry across all sections)

1. Swift 6 language mode, iOS 17 minimum (iOS 26 glass APIs behind `#available`). Confirm minimum with the user in S-00.
2. Layout: Swift package `CriaKit` (logic, no UI, unit-tested with `swift test`) plus the Xcode app target `CriaApp` (SwiftUI). All logic goes in `CriaKit`.
3. SQLite via GRDB. Reuse the existing `src/db/migrations/*.sql` files verbatim (copy, never edit). Same table and column names.
4. Sync upserts never publish change notifications. User mutations always do. (AGENTS.md: infinite loop.)
5. Writes go to the DB and an outbox row in one transaction. The outbox drains FIFO with backoff.
6. Credentials only in Keychain. A transient Keychain error must never fall back to plaintext.
7. Vikunja verbs: GET read, PUT create, POST update, DELETE delete.
8. No setting ships without a reader.
9. Run `swift test` and an `xcodebuild` build before declaring a section done.

---

## Phase 0: Foundations

**S-00 Decisions and scaffold**
- Model: `haiku`
- Confirm: minimum iOS, bundle ID (suggest `io.cria.app.swift` to avoid DB clashes with the Tauri app), SwiftUI-only vs UIKit escape hatches, GRDB vs SwiftData (default GRDB).
- Create `ios-native/` with `CriaKit` package and `CriaApp` Xcode project.
- Done when: empty app launches in simulator, `swift test` runs a placeholder test, CI job builds it.

**S-01 CI**
- Model: `haiku`
- Add `.github/workflows/ci-swift.yml` (macOS runner): `swift test`, `xcodebuild build` for simulator. Path-filtered to `ios-native/**`.
- Done when: green on a trivial PR.

**S-02 Dependency and tooling setup**
- Model: `haiku`
- Add GRDB and `swift-openapi-generator` (or hand-written client, decide here). Add SwiftLint config.
- Done when: package resolves, lint runs in CI.

## Phase 1: Data layer (`CriaKit/Data`)

**S-10 Migration runner**
- Model: `haiku`
- Copy the 19 migrations as bundle resources. Implement an ordered, forward-only runner using GRDB's `DatabaseMigrator` keyed on the same version numbers.
- Test: fresh DB reaches version 19; FTS5 table from `003_fts.sql` exists.
- Done when: tests pass on an in-memory DB.

**S-11 Record types and domain models**
- Model: `haiku`
- Port `src/domain/*` to `Codable` structs with strict decoding. Include the `0001-01-01T00:00:00Z` no-date sentinel mapping (`normaliseDate`).
- Port Zod validation tests as decoding tests with fixtures.
- Done when: fixtures from the Vikunja API decode; sentinel dates become `nil`.

**S-12 Write primitives**
- Model: `haiku`
- Port `db/index.ts` semantics: serial write queue, batched transaction helper, change bus. GRDB gives real transactions, so document the simplified behaviour but keep the API shape (`withTx`, `exec`, `notify`).
- Done when: concurrent-write test shows no interleaving; bus emits only for user mutations.

**S-13 Projects repository**
- Model: `haiku`
- `src/db/projects.ts` port: reads, user mutations, `upsertProjectFromServer` (silent), identifiers, favourites.
- Done when: ported repository tests pass.

**S-14 Tasks repository, part 1 (reads)**
- Model: `haiku`
- List queries and ordering from `listTasksForProject`, local position sort, filters used by smart views.
- Done when: ordering and filter tests pass.

**S-15 Tasks repository, part 2 (writes and merge)**
- Model: `haiku`
- `createTask`, `updateTask`, `deleteTask`, `upsertTaskFromServer`, and `syncMerge.mergeFromServer` including the pending-local-delete guard. Remember write-then-select must happen outside the transaction in the TS layout; keep the same shape.
- Done when: merge tests (dirty, deleted, last_synced snapshot) pass.

**S-16 Labels, relations, reminders, repeat**
- Model: `haiku`
- Label mutations, related tasks, reminders (absolute and relative), recurrence fields.
- Done when: repository tests pass.

**S-17 Views, Kanban, buckets**
- Model: `haiku`
- Views, bucket config, per-view positions, bucket position (migrations 010 to 012).
- Done when: tests pass.

**S-18 Comments, reactions, attachments rows, saved filters**
- Model: `haiku`
- Tables from 005, 013, 014, 018, 019. Pending attachment rows with `cria://pending/{localId}`.
- Done when: tests pass.

**S-19 FTS5 search and query parsers**
- Model: `haiku`
- Port `searchQueryParser`, FTS index maintenance, and `filterQueryParser` plus `filterCompiler` (smart views, saved filters).
- Done when: parser and compiler tests ported and passing.

## Phase 2: API client and auth

**S-20 API client**
- Model: `haiku`
- Generate or hand-write the client for the endpoints actually used (list them from `src/sync/*` and `src/api/*`). Typed errors from `lib/errors.ts`.
- Done when: client tests against recorded fixtures (URLProtocol stub) pass.

**S-21 Keychain credential store**
- Model: `haiku`
- Blob of server URL, token, auth method, refresh token. Per-flavour account name derived from bundle ID. No plaintext fallback on transient errors.
- Test: transient error does not trigger fallback (mirror `auth-storage.test.ts`).
- Done when: tests pass on simulator.

**S-22 Auth flows**
- Model: `haiku`
- Token and username/password login, token refresh with single-flight (duplicate refresh reuses a rotated token, which breaks). Use a Swift actor.
- Done when: concurrent-refresh test issues exactly one refresh.

**S-23 Login screen**
- Model: `haiku`
- SwiftUI login: server URL validation (`accountValidation.ts`), method selection, error display.
- Done when: signs into a real or mock Vikunja instance in the simulator.

## Phase 3: Sync engine (`CriaKit/Sync`)

**S-30 Pull: projects and labels**
- Model: `haiku`
- Port `pull.ts` for projects and labels, silent upserts, `last_synced` snapshot.
- Done when: pull test against fixtures populates DB with no bus events.

**S-31 Pull: tasks and related data**
- Model: `haiku`
- Tasks with pagination and watermark (see migration 017), relations, reminders, comments, attachments metadata, views, buckets.
- Done when: fixture pull test passes; re-pull is idempotent.

**S-32 Deletion reconcile**
- Model: `haiku`
- Port `reconcile.ts`.
- Done when: tests pass.

**S-33 Outbox core**
- Model: `haiku`
- FIFO drain with exponential backoff, re-entry guard (actor), dead-letter handling, per-op executor dispatch.
- Done when: backoff and ordering tests pass.

**S-34 Push executors: tasks**
- Model: `haiku`
- Port `push/task.ts` including every `taskToBody()` quirk (raw `hex_color`, `percent_done` 0 to 100, explicit `false` favourite, explicit `0` repeat fields, `project_id` on move). Port `taskToBody.test.ts` first.
- Done when: body tests pass.

**S-35 Push executors: projects, labels, views, kanban, comments**
- Model: `haiku`
- `push/project.ts`, `label.ts`, `view.ts`, `kanban.ts`, `comment.ts`, `shared.ts`.
- Done when: executor tests pass.

**S-36 Conflict detection**
- Model: `haiku`
- M3 conflict model using `last_synced`; expose a resolvable conflict list.
- Done when: two-client conflict test produces a conflict, resolution clears it.

**S-37 Attachments and blob store**
- Model: `haiku`
- File-based blob store in app support dir (replaces `blobs.rs`), upload executor, `cria://pending` URL rewriting, once-per-launch sweep (24h rule, keep anything uncertain).
- Done when: upload and sweep tests pass.

**S-38 User settings sync**
- Model: `haiku`
- `saveUserSettings` with serial queue, v2 merge-patch path, v1 fallback (GET then POST on 404, 405, 501, non-JSON 2xx), per-server memo of unsupported v2. Never send partial or stale settings. Port `frontendSettings.ts` merge logic and its tests.
- Done when: tests cover both paths and null-dropping.

**S-39 Periodic sync and force sync**
- Model: `haiku`
- 60s poll, paused when app inactive, resumed on foreground; manual refresh; sync status publisher.
- Done when: scene-phase test shows pause and resume.

## Phase 4: App shell and core screens

**S-40 App architecture**
- Model: `haiku`
- Observable app state, dependency container, navigation model (`NavigationStack` plus tab state), sync status banner.
- Done when: signed-in app shows an empty shell driven by DB observation.

**S-41 Design tokens and theme**
- Model: `haiku`
- Port the Llama purple palette, Onest font, dark mode from `globals.css`. Reusable components (chips, buttons, rows).
- Done when: preview catalogue renders in light and dark.

**S-42 Tab bar and navigation**
- Model: `haiku`
- Tabs matching the current iOS layout. iOS 26 gets the system glass `TabView` for free; older iOS the standard bar.
- Done when: tab switching works and state is preserved.

**S-43 Project list and sidebar equivalent**
- Model: `haiku`
- Projects, favourites, hierarchy, colours, create and edit project.
- Done when: matches web build behaviour on a test account.

**S-44 Task list**
- Model: `haiku`
- Row rendering, completion toggle, swipe actions, local ordering, empty states, pull to refresh.
- Done when: list updates live from DB changes.

**S-45 Task detail**
- Model: `haiku`
- Title, description (plain for now), dates, priority, labels, project, favourite, percent done.
- Done when: edits round-trip through outbox to the server.

**S-46 Quick add and NL parser**
- Model: `haiku`
- Port `quickAddParser`, `quickAddPrefixes`, `quickAddProject`, `quickAddSubmit` with all Quick Add Magic modes, plus every parser test. Needs the date parser the TS side uses (check dependencies first).
- Done when: parser test suite fully ported and green; UI sheet creates tasks.

**S-47 Smart views**
- Model: `haiku`
- Today, Upcoming, Inbox, saved filters, filter editor with syntax highlight (`filterHighlight`).
- Done when: results match the web app for the same filters.

**S-48 Search**
- Model: `haiku`
- FTS5 search UI and command-palette equivalent.
- Done when: search returns results offline.

## Phase 5: Rich content

**S-50 Rich text editor spike**
- Model: `haiku`
- Decide: `WKWebView` hosting TipTap (reuse HTML and `sanitizeHtml`) vs native `AttributedString` editor. Build a 1-day spike of the web route first; pick by feel and bridge reliability.
- Done when: decision recorded in this file with evidence.

**S-51 Editor implementation**
- Model: `haiku`
- Per S-50 decision. Must round-trip the HTML Vikunja stores, support inline images (`cria://pending/...`), checklists, links.
- Done when: a description edited in Cria renders correctly in Vikunja-web and vice versa.

**S-52 HTML sanitizer and renderer**
- Model: `haiku`
- Port `lib/sanitize.ts` allow-list; read-only rendering of descriptions and comments.
- Done when: sanitizer tests ported and passing.

**S-53 Comments and reactions**
- Model: `haiku`
- Thread UI, add, edit, delete, reactions, @mentions.
- Done when: round-trips with the server.

**S-54 Attachments UI**
- Model: `haiku`
- Photos picker, document picker, camera, paste, preview with QuickLook, download, delete.
- Done when: offline attach then online upload works.

**S-55 Labels, relations, subtasks**
- Model: `haiku`
- Label picker and creation, related tasks, subtask hierarchy UI.
- Done when: all mutations push correctly.

**S-56 Reminders and recurrence**
- Model: `haiku`
- Absolute and relative reminders, repeat UI (`repeatLabel`), OS scheduling via `UNUserNotificationCenter` with reconcile against the pending list (replaces desktop polling), foreground-only timers.
- Done when: a reminder fires with the app closed.

## Phase 6: Views

**S-60 Kanban**
- Model: `haiku`
- Buckets, card DnD within and across buckets, bucket limits, bucket mutations, `position` math (`lib/position.ts` port).
- Done when: reorder persists and syncs.

**S-61 Table view**
- Model: `haiku`
- Column config, sort engine (`sortEngine`), per-view display config.
- Done when: matches web for sorting.

**S-62 Gantt**
- Model: `haiku`
- Custom timeline layout (`Canvas` or `Layout`), drag to change dates.
- Done when: date edits push correctly.

**S-63 Drag to reorder in lists**
- Model: `haiku`
- `useOptimisticOrder` equivalent, position writes.
- Done when: order survives a sync cycle.

**S-64 View management**
- Model: `haiku`
- Create, edit, delete project views, `viewManagement` rules.
- Done when: parity with web.

## Phase 7: Settings and account features

**S-70 Settings screen, general**
- Model: `haiku`
- Language, timezone, week start, name, reminder defaults, Quick Add Magic mode, all via `saveUserSettings`. Each control has a reader (grep rule).
- Done when: changing a value is visible in Vikunja-web.

**S-71 Local preferences store**
- Model: `haiku`
- Persisted client prefs (replaces `cria:settings/v2`), with a migration versioning scheme from day one.
- Done when: round-trip and migration tests pass.

**S-72 Sharing and teams**
- Model: `haiku`
- Project shares (users, teams, links), teams CRUD. Port `shareInput`, `shareUrl`.
- Done when: parity with web build.

**S-73 Notifications inbox**
- Model: `haiku`
- In-app notifications list (`notificationParse`), mark read.
- Done when: matches server list.

**S-74 API tokens and account**
- Model: `haiku`
- API token management (`apiTokenPermissions`), password change, logout and local data wipe.
- Done when: parity.

**S-75 Project backgrounds and avatars**
- Model: `haiku`
- Background fetch and cache (`projectBackgroundCache`), unsplash if the TS build supports it, cache clearing.
- Done when: caches clear from settings.

## Phase 8: Native extras (iOS-first value)

**S-80 On-device AI (Foundation Models)**
- Model: `haiku`
- Call FoundationModels directly in Swift (the Swift bridge in `src-tauri/swift/CriaAI` mostly disappears). Port prompts from `lib/aiPrompts.ts`; model never does date maths. Keep the availability gate so unsupported devices show no AI buttons.
- Done when: Ramble and summary features work on an Apple Intelligence device.

**S-81 Shopping photo and OCR**
- Model: `haiku`
- Port `shoppingPhoto` flow using Vision directly.
- Done when: photo to task list works on device.

**S-82 Share extension**
- Model: `haiku`
- Create a task from the share sheet. Requires an App Group for the shared DB path (decide in S-00 whether the DB lives in the group container from the start; moving it later needs a migration).
- Done when: sharing a URL creates a synced task.

**S-83 Widgets and App Intents**
- Model: `haiku`
- Today widget, add-task intent, Siri and Shortcuts, Spotlight indexing.
- Done when: widget updates after a sync.

**S-84 Deep links**
- Model: `haiku`
- `cria://` URL handling and Universal Links if used by the Tauri build.
- Done when: links open the right task.

## Phase 9: Hardening and release

**S-90 Accessibility pass**
- Model: `haiku`
- VoiceOver labels, Dynamic Type, reduced motion (replace the joy-layer motion respectfully), contrast.
- Done when: audit with Accessibility Inspector is clean on main screens.

**S-91 Performance pass**
- Model: `haiku`
- 5k-task dataset test, scroll performance in Instruments, DB index review (migration 015), launch time.
- Done when: budgets recorded and met.

**S-92 Offline and failure testing**
- Model: `haiku`
- Airplane mode flows, token expiry mid-drain, server 5xx, dead-letter UI.
- Done when: scripted scenarios pass.

**S-93 Data migration from the Tauri app**
- Model: `haiku`
- Decide: separate install that re-syncs from the server (default, safest), or an import. Document it.
- Done when: a fresh sign-in reproduces a full local state.

**S-94 Packaging and distribution**
- Model: `haiku`
- Signing, unsigned `.ipa` for SideStore (as `release.yml` does), `sidestore.json` entry, nightly lane, versioning that works with `CFBundleShortVersionString`.
- Done when: sideloaded build installs and signs in.

**S-95 Docs and cutover**
- Model: `haiku`
- Update AGENTS.md and FEATURE-COMPARISON.md (mark native iOS status), remove or archive the Tauri iOS lane only when parity is signed off.
- Done when: user signs off parity checklist.

---

## Parity checklist (verify on device before cutover)

Sign-in, 60s sync, create/edit/delete offline, conflict modal, quick add (all magic modes), smart views, saved filters, FTS search, hierarchy, recurrence, reminders when closed, Kanban, table, Gantt, DnD reorder, attachments, comments and reactions, sharing and teams, notifications, settings sync, dark mode, AI features, share extension.

## Status

| Phase | Sections | Status |
|---|---|---|
| 0 Foundations | S-00 to S-02 | done (S-02 CI green on ca9e3ee) |
| 1 Data | S-10 to S-19 | S-10 to S-16 done (CI green on eb5b435); S-17 to S-19 written, CI pending |
| 2 API and auth | S-20 to S-23 | not started |
| 3 Sync | S-30 to S-39 | not started |
| 4 Core screens | S-40 to S-48 | not started |
| 5 Rich content | S-50 to S-56 | not started |
| 6 Views | S-60 to S-64 | not started |
| 7 Settings | S-70 to S-75 | not started |
| 8 Native extras | S-80 to S-84 | not started |
| 9 Release | S-90 to S-95 | not started |

## Nightly operation (native Haiku 5.5)

One-time setup (user): attach `pocketcoder/cria` as the routine's repository in the Routines UI, and check the repo is reachable on the first run.

Each night (the routine session is Haiku 5.5 and does the work itself):
1. Handle resume work first (WIP commit, red CI, `needs-fix`), then the next not-started section(s), in order, whose dependencies are met. Skip `blocked`. Maximum two, one at a time.
2. Port tests first or alongside. Commit small and atomic, push to `feature/swift-ios`, and read macOS CI once (no polling loops).
3. Red CI: one fix attempt, then mark `blocked` with the reason and move on. Never weaken or skip tests.

Weekly (user, manual): run an Opus review (Routines UI, "Run now" on the weekly review routine, or ask Claude). It writes a dated `Review` section, fixes small defects, and unblocks `blocked` sections.
