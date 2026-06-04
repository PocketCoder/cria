# Test coverage implementation plan

**Goal:** raise unit-test coverage from ~15% of source files to ~80%+, prioritised by
risk and implementation effort.

**Status:** 11 test files, 96 tests (baseline).

**Pattern reference:** all existing tests live in `tests/unit/`, use `vitest`
(`describe` / `it` / `expect`), run in the `node` environment via the `forks`
pool, and import source through the `@/` alias. DB-dependent tests use
`beforeAll(initSchema); beforeEach(clearTables)` from `tests/unit/_helpers.ts`.

---

## Phase 1 — Low-hanging fruit (pure functions, no DB, no DOM)

~2 hours total. These are all module-level or pure-IO functions that need
zero setup beyond calling them and asserting the return value.

### 1.1 `src/lib/period.ts` — `tests/unit/period.test.ts`

**Functions to cover:** `secondsToPeriod`, `periodToSeconds`, `formatRelativeReminder`.

`secondsToPeriod` converts a number of seconds to a human description
(`{weeks, days, hours, minutes}`), `periodToSeconds` is the inverse.
`formatRelativeReminder` maps preset keys to display strings (e.g.,
`"15m"` → `"15 minutes before"`).

**Test cases (8–10 tests):**
- `secondsToPeriod` with various inputs (0, 3600 → "1 hour", 90061 → "1 day 1 hour 1 minute 1 second")
- `secondsToPeriod` omits zero-valued units (3600 → "1 hour", not "0 weeks 0 days 1 hour 0 minutes 0 seconds")
- `periodToSeconds` round-trips with `secondsToPeriod`
- `formatRelativeReminder` returns correct label for each preset key (`"5m"`, `"15m"`, `"30m"`, `"1h"`, `"2h"`, `"1d"`, `"2d"`)
- `formatRelativeReminder` falls back to the key itself for unknown keys
- Edge: very large values (weeks overflow)

### 1.2 `src/sync/attachments.ts` — `tests/unit/attachments.test.ts`

**Functions to cover:** `isAttachmentUrl`, `parseAttachmentUrl`, `buildAttachmentUrl`.

These are pure string-parsing functions: `isAttachmentUrl` checks if a URL
matches the Vikunja attachment pattern; `parseAttachmentUrl` extracts
`{taskServerId, attachmentServerId}` from a URL; `buildAttachmentUrl` is the
inverse.

The Tauri-API-dependent functions (`fetchAttachmentBlob`, `uploadAttachment`,
`deleteAttachment`) are **not** pure — mocks would be needed. Defer those.

**Test cases (10–12 tests):**
- `isAttachmentUrl` returns `true` for a valid attachment URL
- `isAttachmentUrl` returns `false` for non-matching URLs (external image, empty, malformed)
- `parseAttachmentUrl` extracts correct IDs from a well-formed URL
- `parseAttachmentUrl` returns `null` for non-matching URL
- `parseAttachmentUrl` handles URLs with query params or trailing slashes
- `buildAttachmentUrl` produces the correct URL given IDs
- Round-trip: `parseAttachmentUrl(buildAttachmentUrl(t, a))` returns `{t, a}`
- Edge: `parseAttachmentUrl` with negative IDs, zero IDs, non-numeric segments

### 1.3 `src/lib/searchQueryParser.ts` — `tests/unit/searchQueryParser.test.ts`

**Functions to cover:** `parseSearchQuery` (and any exported types).

This is a non-trivial parser similar in complexity to `quickAddParser`
(both take a raw string and produce structured tokens). The test pattern
from `quickAddParser.test.ts` (descriptive `it` blocks, one per token type)
applies directly.

**Test cases (12–15 tests), modelling `parseSearchQuery` output:**
- Plain text produces a text token (verbatim match)
- `due:today`, `due:today overdue`, `due:tomorrow` produce date-range tokens
- `due:2024-01-15`, `due:>2024-01-01` produce absolute-date tokens
- `priority:1` produces a priority filter
- `label:"My Label"` produces a label filter (including quoted multi-word)
- `label:foo,bar` produces multiple label tokens
- `is:favorite`, `is:done` produce boolean-flag tokens
- Multiple tokens: `text due:today priority:3` produces the correct array
- Empty string produces no tokens or an empty result
- Trailing/incomplete token: `due:` (no argument) is ignored or produces a text token

### 1.4 `src/domain/*.ts` — `tests/unit/domain.test.ts`

**Files to cover:** `task.ts`, `project.ts`, `label.ts`, `user.ts`, `task-assignee.ts`.

Each exports a `*ResponseSchema` Zod schema. The test strategy for each is
the same: feed valid data, invalid data, and edge values; assert the
parse result. These schemas are the validation gate between the server
and the local DB — a silent parse failure means a missing row.

**Test cases by file (~25 total):**

- **`task.ts`** (8–10 tests):
  - `taskResponseSchema` parses a full server response (all fields populated)
  - Parses minimal response (only required fields)
  - Maps `"0001-01-01T00:00:00Z"` dates to `null` (the sentinel — `normaliseDate`)
  - `hex_color` validation: with/without `#`, empty, null
  - `priority` range (0–5), out-of-range
  - `percent_done` as 0–1 and as 0–100 (both should be accepted)
  - `repeat_mode` enum values (`0`, `"monthly"`, etc.)
  - `task_reminders` array (empty, single, multiple)
  - `task_attachments` array (empty, single)
  - `related_tasks` map (empty, populated)

- **`project.ts`** (4–5 tests):
  - `projectResponseSchema` parses a full response
  - Parses minimal response (id, title)
  - `hex_color` validation
  - `parent_project_id` optional

- **`label.ts`** (3–4 tests):
  - `labelResponseSchema` parses full response
  - `hex_color` validation
  - Required fields missing → parse failure

- **`user.ts`** (3–4 tests):
  - `userResponseSchema` parses full response
  - `userFromServer` transforms correctly
  - Optional fields omitted

- **`task-assignee.ts`** (2–3 tests):
  - `assigneeResponseSchema` parses full response
  - User info nested inside assignee

### 1.5 `src/stores/settings.ts` — `tests/unit/settings.test.ts`

**Functions to cover:** `useSettings` Zustand store (defaults, set, toggle,
persistence contract).

The store uses `persist` (localStorage). In Node, `localStorage` is missing,
so the test needs `vi.stubGlobal('localStorage', ...)` or the store may need
a mock adapter. Simpler approach: reset the store state directly with
`useSettings.setState()` and assert defaults + transitions.

**Test cases (5–6 tests):**
- Default values are correct (date format, time format, theme, etc.)
- `setDateFormat`, `setTimeFormat` update state
- `setTheme` cycles light/dark/system
- Toggling boolean settings (autostart, tray, notification, completion sound)
- Setting a value and reading it back produces the same value
- (Optional) `persist` rehydrates from a stubbed localStorage key

---

## Phase 2 — DB repository tests

~4–5 hours total. Each test file creates an in-memory SQLite DB with
`initSchema()` / `clearTables()` (already wired via `_helpers.ts`), seeds a
row, calls the repository function, and `select`s from the DB to assert the
result.

### 2.1 `src/db/index.ts` — `tests/unit/db.test.ts`

**Key primitives to cover:** `getDb`, `exec`, `withTx`, `serial`.

These are the foundation every write path depends on. `withTx` in particular
has subtle semantics (batched writes, no read-your-writes inside the
callback — see AGENTS.md).

**Test cases (8–10 tests):**
- `exec` runs a statement and returns rows affected
- `exec` throws on invalid SQL
- `serial` queues two functions and they run in order (side-effect assertion)
- `withTx` commits multiple writes atomically
- `withTx` rolls back on error (no partial write visible after rejection)
- `withTx` batch: two `db.execute()` calls in the callback produce exactly
  one `execute_tx` invocation (or the batched equivalent)
- `withTx` SELECT reads **pre-batch** state (the no-read-your-writes rule)
- Concurrent `serial` calls are serialised (race-condition guard)

### 2.2 `src/db/projects.ts` — `tests/unit/projects.test.ts`

**Functions to cover:** `listProjects`, `getProjectByLocalId`, `createProject`,
`updateProject`, `deleteProject`.

The DB-dependent lifecycle is already exercised indirectly by
`upsertFromServer.test.ts`. Direct CRUD tests fill holes.

**Test cases (6–8 tests):**
- `createProject` inserts a row with the right fields and returns a `local_id`
- `createProject` with a `server_id` stores it correctly
- `getProjectByLocalId` returns the correct row
- `getProjectByLocalId` returns `undefined` for missing ID
- `updateProject` modifies fields (`title`, `hex_color`, `is_archive`)
- `deleteProject` soft-deletes (sets `deleted = 1`)
- `listProjects` excludes deleted projects
- `listProjects` returns all non-deleted projects, sorted

### 2.3 `src/db/tasks.ts` — `tests/unit/tasks.test.ts`

**Functions to cover:** `createTask`, `updateTask`, `deleteTask`,
`listTasksForProject`, `getTaskByLocalId`, `duplicateTask`, `moveTask`,
`searchTasks`.

This is the largest and most critical file (~618 lines). It overlaps with
`sync.test.ts` (which covers the outbox + dirty flag for create/update/delete)
but doesn't test the data correctness of `listTasksForProject` or the more
complex mutations.

**Test cases (10–14 tests):**
- `createTask` inserts with correct fields, dirty=1, outbox row created
- `createTask` with a `server_id` stores it (offline-created tasks later synced)
- `getTaskByLocalId` returns the correct row
- `getTaskByLocalId` returns `undefined` for missing ID
- `updateTask` modifies fields, marks dirty, adds outbox entry
- `deleteTask` soft-deletes, marks dirty, adds outbox entry
- `listTasksForProject` returns tasks for the given project, ordered by position
- `listTasksForProject` excludes deleted tasks
- `duplicateTask` creates a new task with the same title/description/priority,
  different `local_id`, dirty=1
- `moveTask` updates `project_id`, marks dirty
- `searchTasks` returns matching rows (basic FTS5 text match)
- `searchTasks` with no matches returns empty array
- (With a server_id task) `searchTasks` by server_id works

### 2.4 `src/db/labels.ts` — `tests/unit/labels.test.ts`

**Functions to cover:** `createLabel`, `updateLabel`, `deleteLabel`,
`listLabels`, `listLabelsForTask`, `toggleTaskLabel`, `applyLabelsByTitle`.

Label logic is non-trivial because `toggleTaskLabel` may need to create the
label inline (if it doesn't exist) or look up by title.

**Test cases (8–10 tests):**
- `createLabel` inserts a label, returns `local_id`
- `updateLabel` modifies title/hex_color
- `deleteLabel` soft-deletes
- `listLabels` returns all non-deleted labels
- `listLabelsForTask` returns labels attached to a task
- `toggleTaskLabel` attaches a label if not present
- `toggleTaskLabel` detaches a label if present
- `applyLabelsByTitle` creates labels by title if they don't exist
- `applyLabelsByTitle` reuses existing labels by title

### 2.5 `src/db/reminders.ts` — `tests/unit/reminders.test.ts`

**Functions to cover:** `addReminder`, `removeReminder`,
`listRemindersForTask`, `listUnnotifiedReminders`, `markReminderNotified`.

**Test cases (6–8 tests):**
- `addReminder` inserts a reminder with correct fields
- `addReminder` with a `server_id` stores it
- `removeReminder` deletes by `local_id`
- `listRemindersForTask` returns reminders for the given task
- `listUnnotifiedReminders` returns only reminders whose trigger time has
  passed and that haven't been notified
- `markReminderNotified` sets `notified_at`
- `markReminderNotified` is idempotent

### 2.6 `src/db/task-assignees.ts` — `tests/unit/task-assignees.test.ts`

**Functions to cover:** `addTaskAssignee`, `removeTaskAssignee`,
`listAssigneesForTask`.

**Test cases (4–5 tests):**
- `addTaskAssignee` inserts an assignee row
- `addTaskAssignee` with a `server_id` stores it (already-synced assignee)
- `removeTaskAssignee` deletes by `local_id`
- `listAssigneesForTask` returns assignees for the task
- Adding the same assignee twice is a no-op or updates (document behaviour)

### 2.7 `src/db/attachments.ts` — `tests/unit/db-attachments.test.ts`

**Functions to cover:** `replaceTaskAttachmentsFromServer`,
`listAttachmentsForTask`, `upsertAttachmentLocal`, `deleteAttachmentLocal`,
`listTaskLocalIdsWithAttachments`.

**Test cases (5–6 tests):**
- `upsertAttachmentLocal` inserts a new attachment row
- `upsertAttachmentLocal` updates an existing attachment
- `deleteAttachmentLocal` marks deleted
- `listAttachmentsForTask` returns attachments for the task
- `replaceTaskAttachmentsFromServer` replaces the full set (mirrors server state)

---

## Phase 3 — High-risk infrastructure

~2–3 hours total. The sync-in path and the write-chain primitives have no
tests despite being the most likely source of data-loss bugs.

### 3.1 `src/sync/pull.ts` — `tests/unit/pull.test.ts`

**Challenge:** `pull.ts` calls the API client (`callApi`) and the DB
repositories. Both need mocking. The test pattern from `sync.test.ts`
(which mocks the API client) applies.

**Key paths to test (4–6 tests, each mocking `callApi`):**
- `pullTasksForProject` with a valid server response: Zod parse succeeds,
  `upsertTaskFromServer` is called with the parsed data
- `pullTasksForProject` with a malformed server response: error is caught,
  no crash, no partial DB state
- `pullTasksForProject` when the server returns 401/403: skip or abort
  (the auth error path)
- `pullLabels` with a valid response: labels are upserted
- `pullAll` iterates all synced projects

### 3.2 `src/db/bus.ts` — `tests/unit/bus.test.ts`

**Functions to cover:** `subscribe`, `notify`, `_clearAllListeners`.

The change bus is the signalling layer that triggers query invalidation.
A bug here means stale UI or infinite loops.

**Test cases (5–6 tests):**
- `notify` fires all subscribers for the topic
- `notify` does NOT fire subscribers for other topics
- `subscribe` returns an unsubscribe function
- `unsubscribe` removes the listener (subsequent notify doesn't fire it)
- `notify` with no subscribers does not throw
- `_clearAllListeners` removes all subscriptions

---

## Phase 4 — Lower-ROI / requires harness

~3–5 hours total. These areas benefit less from pure unit tests and more
from component or integration tests. Included for completeness but deferred.

### 4.1 Zustand UI store — `tests/unit/ui-store.test.ts`

**`src/stores/ui.ts`** — simple state transitions (active view, sidebar
collapse, selected task). ~5 tests, pure Zustand, no DOM needed.

### 4.2 Tauri wrappers — deferred

**`src/tauri/`** — all four files (`updater.ts`, `globalShortcut.ts`,
`autostart.ts`, `notification.ts`) are thin wrappers around
`@tauri-apps/plugin-*` calls. They need `mockIPC` or a Tauri test runtime.
Not worth unit-testing unless a bug surfaces; the wrapping logic is ~5–15
lines each.

### 4.3 TanStack Query hooks — deferred

**`src/queries/`** — all 15 files are React hooks built on TanStack Query.
Testing them requires `@tanstack/react-query`'s `QueryClientProvider`
wrapper + a React renderer (testing-library/react). Add to the test
harness only after `jsdom` environment setup.

### 4.4 React components — deferred

**`src/components/`** + **`src/features/`** — require
`@testing-library/react` + `jsdom`. A `vitest.environment: 'jsdom'`
override in the vitest config would be needed. Worth adding when a
component has regressed more than once.

---

## Appendix A — Summary table

| Phase | File | Est. time | Tests | Risk reduction |
|---|---|---|---|---|
| 1.1 | `period.ts` | 15 min | 8–10 | Low |
| 1.2 | `attachments.ts` (parsers) | 30 min | 10–12 | Medium (feeds LRU cache) |
| 1.3 | `searchQueryParser.ts` | 45 min | 12–15 | Medium (search correctness) |
| 1.4 | `domain/*.ts` | 45 min | 20–25 | **High** (silent parse failures) |
| 1.5 | `settings.ts` | 30 min | 5–6 | Low–Medium |
| **P1 subtotal** | | **~2.75 h** | **55–68** | |
| 2.1 | `db/index.ts` | 1 h | 8–10 | **High** (foundation) |
| 2.2 | `db/projects.ts` | 1 h | 6–8 | **High** (sidebar CRUD) |
| 2.3 | `db/tasks.ts` | 2 h | 10–14 | **High** (core CRUD) |
| 2.4 | `db/labels.ts` | 1 h | 8–10 | Medium |
| 2.5 | `db/reminders.ts` | 1 h | 6–8 | Medium (reminder correctness) |
| 2.6 | `db/task-assignees.ts` | 30 min | 4–5 | Low–Medium |
| 2.7 | `db/attachments.ts` | 30 min | 5–6 | Low |
| **P2 subtotal** | | **~7 h** | **47–61** | |
| 3.1 | `pull.ts` | 1.5 h | 4–6 | **High** (sync-in correctness) |
| 3.2 | `bus.ts` | 30 min | 5–6 | **High** (stale UI avoidance) |
| **P3 subtotal** | | **~2 h** | **9–12** | |
| **Total** | | **~12 h** | **111–141** | |

## Appendix B — Implementation tips

1. **Use existing patterns.** Every test file should follow the conventions
   in `conflictDiff.test.ts` or `taskToBody.test.ts`: import from `@/`,
   plain `describe`/`it`/`expect`, no `jsdom`, no component wrappers.
2. **DB tests always need `initSchema` + `clearTables`.** See
   `relations.test.ts` for the canonical lifecycle (`beforeAll(initSchema)`,
   `beforeEach(clearTables)`).
3. **Mock the API client, not the DB.** When testing `pull.ts`, mock
   `createApiClient` (or `callApi`) — let the real DB repositories handle
   persistence. This catches integration bugs, not just unit-isolated ones.
4. **String `URL.revokeObjectURL` for any test that touches `LRUMap`.** The
   LRU cache tests in `lruCache.test.ts` use the `vi.spyOn(URL, 'revokeObjectURL')`
   pattern. Copy it.
5. **Don't test React components or TanStack Query hooks without the harness.**
   They need `jsdom`, `QueryClientProvider`, and `@testing-library/react`.
   Defer to a later phase.
