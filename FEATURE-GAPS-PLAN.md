# FEATURE-GAPS-PLAN.md — Vikunja features Cria lacks

Compared against Vikunja `main` (e7d7f17, 6 Oct 2026) on 9 Oct 2026. Specs are
deliberately loose: enough to start, not to finish. Status per feature lives in
[FEATURE-COMPARISON.md](FEATURE-COMPARISON.md); update it when you ship one.

Ground truth for behaviour is the Go handler in a Vikunja clone, not
`schema.ts` (see the settings-POST gotcha in `AGENTS.md`). Endpoint names below
come from `pkg/routes/routes.go` (v1) and `pkg/routes/api/v2/` (v2).

## Ground rules

- **Two kinds of feature.** Synced entities (tasks, comments, time entries)
  follow the offline pattern: migration, zod schema in `src/domain/`,
  repository in `src/db/`, `upsertXFromServer` (silent), executor in
  `src/sync/push/`. Account and admin features (webhooks, sessions, bots,
  admin) are **online-only** direct API calls from a settings tab, like
  `TeamsTab` and `TokensTab`. Don't add outbox plumbing for the second kind.
- **Full-object POSTs.** Read the handler before sending a subset of any
  entity.
- **Version gating.** Vikunja is mid-move from v1 to v2 (`/api/v2`). Check
  `GET /info` and fall back or hide the feature on older servers.
- **iOS.** Anything that needs a file picker, a long-lived socket or a
  background timer needs `isMobilePlatform()` / `isPageVisible()` thought.
- **Done means wired.** A setting with no reader is ❌/🟡, never ✅.

## Suggested order

| # | Feature | Size | Why this slot |
|---|---|---|---|
| 1 | Time tracking | L | Largest user-facing gap, new synced entity |
| 2 | Live sync (WebSocket) | M | Removes the 60s lag; unlocks push-style notifications |
| 3 | Duplicate project | S | One endpoint, one menu item |
| 4 | Project backgrounds | M | Visible polish; two sources |
| 5 | Webhooks (project + user) | M | Online-only CRUD |
| 6 | Sessions, bots, atom feeds | S each | Online-only settings tabs |
| 7 | Import / migration | M | Mostly server-side; thin UI |
| 8 | Sign-in: register, reset, OIDC, OAuth | L | Platform-specific auth flows |
| 9 | Admin area | M | Only useful to instance admins |
| 10 | Small gaps | S each | Fill in between |

---

## 1. Time tracking

**What Vikunja has.** Time entries on a task or directly on a project, a live
timer, a timer badge in the header, a task-level list and form, and a
`/time-tracking` overview view.

**API (v2).** `GET/POST /time-entries`, `GET/PUT/DELETE /time-entries/{id}`,
`GET /tasks/{task_id}/time-entries`, `GET /projects/{project_id}/time-entries`,
`POST /time-entries/timer/stop`. Fields: `id`, `task_id` xor `project_id`,
`start_time`, `end_time` (null means a timer is running), `comment`. Server
sets `user_id`.

**Spec.**
- Task detail section: list entries, add manual entry (start, end, comment),
  start/stop timer, total duration.
- Header badge showing the running timer; one running timer at a time (confirm
  server behaviour on a second start).
- Overview view with a date range and per-project totals.

**Implementation.**
1. Check whether the target server exposes v2; if not, hide the feature.
   Regenerate types (`pnpm generate:api`) or hand-write a small client, since
   `schema.ts` comes from v1 Swagger.
2. Migration `020_time_entries.sql` with the standard sync columns; zod schema
   in `src/domain/timeEntry.ts`; `src/db/timeEntries.ts`.
3. Outbox executor `src/sync/push/timeEntry.ts`. Start a timer locally by
   creating a row with `end_time = null`; stopping sets `end_time` and pushes
   an update. A timer must survive restart, so derive elapsed from
   `start_time`, never a counter.
4. Pull per task on detail open, plus one pull for the running timer on boot.
5. UI: `features/task-detail/TimeTracking.tsx`, `TimerBadge` in the shell
   header, overview under `features/time-tracking/`.

**Risks.** Clock skew between device and server on `start_time`; a timer left
running across devices; offline stop followed by a conflicting server stop.

**Tests.** Duration maths, running-timer derivation, outbox ordering.

## 2. Live sync (WebSocket)

**What Vikunja has.** `GET /ws`. The first message authenticates, then the
client subscribes to named events. Messages: `{action: "auth", token}`,
`{action: "subscribe", event}`, `{action: "unsubscribe", event}`. Server pushes
`{event, data}` and replies `auth.success` / `unsubscribed`. Auth must arrive
within 30s of connecting. Known event: `notification.created`; time-entry
events exist too. Read `pkg/websocket/listener.go` for the full list before
building.

**Spec.** Keep the 60s poll as the fallback. When the socket is up, a push
event triggers an immediate targeted pull instead of waiting for the tick.

**Implementation.**
1. `src/sync/socket.ts`: connect, auth, subscribe, reconnect with backoff.
   Use the Tauri websocket plugin or the HTTP plugin's equivalent so it
   bypasses webview limits; check it's allowed in `capabilities/default.json`
   (shared, not desktop-only).
2. Pin connection state on `globalThis.__cria_socket__` so HMR can't orphan it.
3. On event: call the existing pull entry points. **Never** call `notify()`
   from the handler path for sync upserts (loop footgun in `AGENTS.md`).
4. Pause on mobile when `isPageVisible()` is false; reconnect on
   `visibilitychange`.
5. Surface state in the footer sync indicator.

**Risks.** Token expiry mid-connection (refresh, then re-auth); proxies that
drop idle sockets (needs a ping or reconnect timer).

## 3. Duplicate project

**API.** `PUT /projects/{projectid}/duplicate` (v1), `project_duplicate.go`
(v2). Returns the new project.

**Spec.** "Duplicate" in the project context menu. Online-only; after success,
pull projects and navigate to the copy. Decide whether the copy keeps tasks,
views and sharing by reading the handler.

**Implementation.** `src/api/projects.ts` call, menu item in `SidebarRows`,
disabled when offline. No outbox.

## 4. Project backgrounds

**API.** `GET/DELETE /projects/{id}/background`,
`PUT /projects/{id}/backgrounds/upload`, `GET /backgrounds/unsplash/search`,
`POST /projects/{id}/backgrounds/unsplash`, plus image and thumb routes.
Unsplash is only available if the instance enables it (check `/info`).

**Spec.** Project settings: upload an image, search Unsplash, remove. Show the
background in the project header; keep it subtle in the Ledger design.

**Implementation.**
1. Auth-fetch the image like `VikunjaImage` does, cache it in the existing
   blob store (`tauri/blobStore.ts`), key by project id and `updated`.
2. Upload through the file picker (desktop) or photo picker (iOS).
3. `ProjectSettingsModal` gets a Background section. Online-only.

## 5. Webhooks (project and user)

**API.** Project: `GET/PUT /projects/{p}/webhooks`,
`POST/DELETE /projects/{p}/webhooks/{id}`. User: `/user/settings/webhooks`.
Events list: `GET /webhooks/events`. Fields: `target_url`, `events[]`,
`secret`, `basic_auth_user`, `basic_auth_password` (the last three are
write-only and never returned).

**Spec.** List, create, edit, delete. Event checkboxes from the events
endpoint. Secret fields show as set or unset, never the value.

**Implementation.** `src/api/webhooks.ts`; a Webhooks tab in settings and a
section in `ProjectSettingsModal`. Because secrets are write-only, an edit must
resend them or leave them blank deliberately: confirm in the handler whether a
blank value clears them (full-object replace risk).

## 6. Sessions, bots, atom feeds

- **Sessions.** `GET /sessions`, `DELETE /sessions/{id}`. List devices, revoke
  one, highlight the current. Fits the Security tab.
- **Bots.** `GET/PUT /bots`, `GET/POST/DELETE /bots/{id}`. List and create bot
  users; bots then authenticate with API tokens. New settings tab; hide on
  servers without the route.
- **Atom feeds.** `GET /notifications.atom`. A settings tab that shows the feed
  URL and how to create the token it needs. Mostly copy, little code.

All online-only direct calls in `src/api/`.

## 7. Import / migration

**What Vikunja has.** A migrate area with per-service flows (OAuth or
credentials for Todoist, Trello and others), file upload, and a CSV importer
(`migration_csv.go`, `migration_file.go`, `migration_oauth.go`).

**Spec.** Phase one: file-based and CSV imports only, since they need no OAuth
redirect. Phase two: OAuth services via the system browser and deep link.

**Implementation.**
1. Read `migration_*.go` for the exact request shapes and the status polling.
2. Settings → Data gets an "Import" section: pick service, pick file, upload,
   poll status, then force a full pull.
3. OAuth phase reuses the `vikunja://` deep-link handler in `Shell.tsx`.

## 8. Sign-in options

- **Registration** (`POST /register`) and **password reset**
  (`POST /user/password/token`, `/user/password/reset`): plain forms on
  `LoginScreen`, shown only if `/info` says registration is enabled.
- **OpenID / SSO** (`/auth/openid/{provider}/callback`): open the provider URL
  in the system browser, return through a deep link. Needs a redirect URI the
  server accepts for a custom scheme; check `auth_openid.go` and Vikunja's
  `DesktopLogin.vue`, which already does something similar.
- **OAuth authorize** (`/oauth/authorize`, `/oauth/token`): lower priority; only
  needed if Cria should act as an OAuth client rather than use a token.

Credentials must keep flowing through `auth/storage.ts` and the keychain. Never
fall back to localStorage on a transient keychain error.

## 9. Admin area

**API (v2).** `admin_users`, `admin_projects`, `admin_teams`,
`admin_invite_links`, plus `PATCH /users/{id}/admin`, `/users/{id}/status`,
`/projects/{id}/owner`.

**Spec.** Visible only to server admins. Users (status, admin flag), projects
(reassign owner), invite links, overview. Hide entirely for non-admins and on
v1 servers. Low priority for a personal client.

## 10. Small gaps

| Gap | Note |
|---|---|
| Project info page | Read-only description and metadata |
| Defer task | Push due date by a preset interval; reuse the date helpers |
| Drag-reorder projects in sidebar | `position` field on projects; reuse `useOptimisticOrder` |
| View filter editing and bucket config | Extend `ViewManagerModal` |
| Language and timezone | Wire i18n (#78) and display timezone (#76), or remove the controls |
| MCP settings tab | Instance-dependent; read `Mcp.vue` before deciding |
| Windows and Linux builds | Needs a CI matrix and per-OS capabilities; macOS-only today |
| macOS notarisation | `1.0.0` gate |
