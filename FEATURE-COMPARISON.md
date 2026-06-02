# FEATURE-COMPARISON.md — Cria vs Vikunja

Last updated: Sun May 31 2026

## Legend
| Icon | Meaning |
|---|---|
| ✅ | Shipped (in `dev`) |
| ⏳ | Pending PR (created, awaiting merge into `dev`) |
| ❌ | Not started |

## Feature table

### Tasks

| Category | Feature | Status | Notes |
|---|---|---|---|
| Tasks | Basic CRUD (create/read/update/delete) | ✅ | Full offline-first CRUD via outbox |
| Tasks | Toggle done/undone | ✅ | Via TaskActions + inline row click |
| Tasks | Duplicate task | ✅ | `duplicateTask` in db/tasks, wired in TaskActions |
| Tasks | Move to different project | ✅ | `moveTask` in db/tasks, project picker in TaskActions |
| Tasks | Delete with undo | ✅ | 20s undo toast via UndoToast |
| Tasks | Inline field editing (dates, priority, color) | ✅ | Popover pickers in TaskActions |
| Tasks | Percent done slider | ✅ | 0–100 slider in TaskActions |
| Tasks | Natural-language quick-add (date, #label, !priority, @assignee) | ✅ | `quickAddParser` + QuickAddPreview |
| Tasks | **+ProjectName in quick-add** | ⏳ | PR #50 (`feat/nl-project-syntax`), stacked on `feat/quick-features` |
| Tasks | **NL recurrence in quick-add (every day/week etc.)** | ⏳ | PR #51 (`feat/nl-recurrence`), stacked on `feat/quick-features` |
| Tasks | **Task identifier (PROJ-42) in detail card** | ⏳ | PR #46 (`feat/task-identifier`), stacked on `feat/quick-features` |
| Tasks | **Checklist progress bar on rows** | ⏳ | PR on `feat/quick-features` (455096c), not yet in `dev` |
| Tasks | **Task-list checkbox alignment + persistence in TipTap** | ⏳ | PR on `feat/quick-features` (246a1eb), not yet in `dev` |
| Tasks | Sub-tasks tree (indented + collapsible) | ✅ | M8 (#45), via task relations `subtask` kind |
| Tasks | Sub-task promote/demote | ✅ | M8 (#45) |
| Tasks | Related tasks panel (11 relation kinds) | ✅ | M8 (#45), RelatedTasks in detail card |
| Tasks | Recurrence (repeat_after/repeat_mode) | ✅ | M8 (#45), UI picker in TaskActions |
| Tasks | Task detail floating card | ✅ | Right-docked card, Escape to close |
| Tasks | Assignees (add/remove) | ✅ | Via TaskActions + user picker |
| Tasks | Labels (apply/remove) | ✅ | Via TaskActions + LabelChips |
| Tasks | **Inline label creation when adding labels** | ⏳ | PR #49 (`feat/inline-label-creation`), stacked on `feat/quick-features` |
| Tasks | Favorites (is_favorite) | ✅ | Star toggle in TaskActions |
| Tasks | Description WYSIWYG editor (TipTap) | ✅ | Full TipTap with slash commands, images, links |
| Tasks | Copy task link/identifier | ✅ | Copy icon in detail header — copies server URL or falls back to title |
| Tasks | Bulk operations (multi-select, batch actions) | ❌ | Not started |
| Tasks | Hover preview popup | ❌ | Not started |

### Projects

| Category | Feature | Status | Notes |
|---|---|---|---|
| Projects | CRUD | ✅ | Full create/rename/delete in sidebar |
| Projects | Favorite/unfavorite | ✅ | Star toggle, filter sidebar shows Favorites view |
| Projects | Archive | ✅ | Archive toggle in sidebar context menu |
| Projects | Hex color picker | ✅ | Shown in sidebar |
| Projects | Sidebar list (flat) | ✅ | Sortable, filterable |
| Projects | Sub-project hierarchy in sidebar | ❌ | Flat list only; parent_project_id in schema |
| Projects | Project background images | ❌ | Not started (Unsplash integration) |
| Projects | Customizable project identifier | ❌ | Not started (server assigns identifier) |

### Labels

| Category | Feature | Status | Notes |
|---|---|---|---|
| Labels | CRUD | ✅ | Sidebar create/rename/delete |
| Labels | Toggle on task (multi-select) | ✅ | LabelChips + LabelManagerModal |
| Labels | Label chips on task rows | ✅ | Inline display |
| Labels | **Inline label creation when adding to task** | ⏳ | PR #49, stacked on `feat/quick-features` |
| Labels | Label manager modal | ✅ | Full create-as-you-type |

### Smart Views

| Category | Feature | Status | Notes |
|---|---|---|---|
| Smart Views | Today (overdue + due today) | ✅ | `TodayView` in SmartViews |
| Smart Views | Upcoming (next 7 days, grouped by day) | ✅ | `UpcomingView` in SmartViews |
| Smart Views | Favorites (favorited tasks) | ✅ | `FavoritesView` in SmartViews |
| Smart Views | Label tasks (per-label) | ✅ | `LabelView` in SmartViews |
| Smart Views | Inbox (tasks without a project) | ❌ | SPEC mentions it; not implemented |
| Smart Views | Saved filters (Vikunja filter DSL) | ❌ | Not started |

### Search

| Category | Feature | Status | Notes |
|---|---|---|---|
| Search | FTS5 full-text search | ✅ | `003_fts.sql` migration, searchQueryParser |
| Search | Prefix expansion (typeahead) | ✅ | FTS5 prefix index |
| Search | Filter query parser (text, due range, priority, label) | ✅ | SearchQueryPreview shows parsed filters |
| Search | Results rendered in task list | ✅ | Reuses SmartTaskRow |

### Attachments

| Category | Feature | Status | Notes |
|---|---|---|---|
| Attachments | Upload (button + drag-drop) | ✅ | AttachmentList + uploadAttachment |
| Attachments | Delete | ✅ | Per-row delete |
| Attachments | Download | ✅ | Via Tauri save dialog |
| Attachments | Inline images in descriptions | ✅ | VikunjaImage extension + auth-fetch |
| Attachments | Image lightbox | ✅ | ImageLightbox component |
| Attachments | Paperclip indicator on task rows | ✅ | Shows count in TaskList |

### Reminders

| Category | Feature | Status | Notes |
|---|---|---|---|
| Reminders | In-app set/clear (date+time) | ✅ | PR #39, ReminderList component |
| Reminders | **Relative reminders ("1h before due")** | ⏳ | PR #51 stacked on `feat/quick-features` (b1eb723) |
| Reminders | Desktop notifications (plugin-notification) | ✅ | Shipped |
| Reminders | macOS Dock badge | ✅ | Shipped |
| Reminders | Reminder scheduler | ✅ | Shipped |
| Reminders | Notifications disabled gate + system-settings link | ✅ | Shipped |

### Comments

| Category | Feature | Status | Notes |
|---|---|---|---|
| Comments | Read comments on task | ❌ | Not started |
| Comments | Write/create comments | ❌ | Not started |
| Comments | @mentions in comments | ❌ | Not started |
| Comments | In-app notification inbox for @mentions | ❌ | Not started |

### Task Relations

| Category | Feature | Status | Notes |
|---|---|---|---|
| Task Relations | 11 relation kinds (subtask, parent, duplicate, related, etc.) | ✅ | M8 (#45) |
| Task Relations | Bidirectional add/remove | ✅ | M8 (#45) |
| Task Relations | RelatedTasks panel in detail | ✅ | M8 (#45) |
| Task Relations | Sub-task tree in task list | ✅ | M8 (#45), indented + collapsible |

### Sync

| Category | Feature | Status | Notes |
|---|---|---|---|
| Sync | Periodic 60s background pull | ✅ | `usePeriodicSync` |
| Sync | Outbox push with exponential backoff | ✅ | `drainOutbox` in push.ts |
| Sync | Conflict detection (field-level) | ✅ | `mergeFromServer` in syncMerge.ts |
| Sync | Conflict resolution UI (keep mine / use theirs) | ✅ | ConflictModal component |
| Sync | Delete reconciliation (tombstone sweep) | ✅ | reconcile.ts |
| Sync | Last-synced snapshot for 3-way merge | ✅ | `_lastSynced` JSON column |
| Sync | Live sync via WebSockets | ❌ | SPEC §3.5 proposed; not started |

### Auth

| Category | Feature | Status | Notes |
|---|---|---|---|
| Auth | API token + server URL login | ✅ | LoginScreen |
| Auth | Sign-out | ✅ | Shell footer |
| Auth | Token stored in localStorage | ✅ | auth/storage.ts |
| Auth | Server health probe (`/info`) | ✅ | LoginScreen probes before auth |

### API Client

| Category | Feature | Status | Notes |
|---|---|---|---|
| API | OpenAPI generated types | ✅ | schema.ts from `openapi-typescript` |
| API | `openapi-fetch` client | ✅ | api/client.ts |
| API | Custom fetch for CORS | ✅ | Via Tauri HTTP plugin |
| API | Error classification (retryable) | ✅ | api/errors.ts |

### Native Integration

| Category | Feature | Status | Notes |
|---|---|---|---|
| Native | SQLite with migrations (8 migrations) | ✅ | 001–008, forward-only |
| Native | Single instance (Tauri plugin) | ✅ | plugin-single-instance |
| Native | macOS Dock badge (reminder count) | ✅ | In queries/badge.ts |
| Native | Global shortcut (Cmd+Shift+A → quick add) | ✅ | tauri/globalShortcut.ts |
| Native | Autostart (toggle in footer) | ✅ | tauri/autostart.ts |
| Native | Auto-updater (Tauri plugin) | ✅ | tauri/updater.ts, release workflow |
| Native | Deep links (vikunja://task|project) | ✅ | Shell.tsx handles `tauri://url` |
| Native | Dev/release side-by-side (identifier isolation) | ✅ | tauri.dev.conf.json |
| Native | Notifications (plugin-notification) | ✅ | tauri/notification.ts |
| Native | Tray icon | ❌ | SPEC §10.1; not started |
| Native | Global shortcuts configuration UI | ❌ | Hardcoded only |
| Native | macOS notarisation | ❌ | V1.0.0 gate |
| Native | Windows/Linux builds | ❌ | macOS-only matrix in CI |

### UI

| Category | Feature | Status | Notes |
|---|---|---|---|
| UI | Three-pane shell (sidebar + list + detail) | ✅ | Shell.tsx |
| UI | Collapsible sidebar | ✅ | Zustand state toggle |
| UI | Collapsible detail card | ✅ | Escape to close |
| UI | TipTap WYSIWYG (bold, italic, headings, lists, code, links) | ✅ | RichTextEditor |
| UI | TipTap slash-command menu | ✅ | `/heading`, `/bullet`, etc. |
| UI | TipTap inline images (Vikunja-compatible) | ✅ | VikunjaImage extension |
| UI | QuickAddModal (Cmd+Shift+A) | ✅ | QuickAddModal.tsx |
| UI | Inline quick-add in project view | ✅ | QuickAddPreview |
| UI | Outbox modal | ✅ | OutboxModal |
| UI | Conflict modal | ✅ | ConflictModal |
| UI | Undo toast | ✅ | UndoToast |
| UI | Update-ready banner | ✅ | UpdateBanner |
| UI | Online/offline indicator in footer | ✅ | Green/amber/red dot |
| UI | Sync status (pending count) | ✅ | Footer shows outbox count |
| UI | Cmd+K command palette | ❌ | Not started (M7) |
| UI | Per-row keyboard shortcuts (j/k, e, d, l, p) | ❌ | Not started (M7) |
| UI | Rebindable shortcuts in settings | ❌ | Not started (M7) |
| UI | Settings page (language, timezone, date format, color scheme) | ❌ | Not started |
| UI | Inbox view (no-project tasks) | ❌ | Not started |
| UI | Kanban view | ❌ | Not started (M9) |
| UI | Table view (dense, sortable) | ❌ | Not started (M9) |
| UI | Gantt view | ❌ | Not started (M10) |
| UI | Drag-to-reorder tasks | ❌ | Not started (M9) |
| UI | Drag-to-reorder projects in sidebar | ❌ | Not started |
| UI | Recent projects in sidebar | ❌ | Not started |
| UI | Task hover preview popup | ❌ | Not started |

### Settings & Configuration

| Category | Feature | Status | Notes |
|---|---|---|---|
| Settings | User preferences (language, timezone, date format) | ❌ | Not started |
| Settings | Account info display | ✅ | Shows name in header |
| Settings | Autostart toggle | ✅ | Footer |
| Settings | Sign out | ✅ | Header button |
| Settings | Global shortcuts config | ❌ | Not started |
| Settings | Appearance (color scheme) | ❌ | Not started |

### Export/Import

| Category | Feature | Status | Notes |
|---|---|---|---|
| Export/Import | Vikunja data export | ❌ | Not started |
| Export/Import | Import from Todoist/Trello/Asana/etc. | ❌ | Server-side exists, no UI |
| Export/Import | Duplicate task (server endpoint) | ✅ | `duplicateTask` in db/tasks |
| Export/Import | Duplicate project | ❌ | Server endpoint exists, no UI |

### Miscellaneous

| Category | Feature | Status | Notes |
|---|---|---|---|
| Misc | CalDAV docs link in settings | ❌ | Not started |
| Misc | Webhook management UI | ❌ | Server endpoints exist, no UI |
| Misc | External-link handling (opens in OS browser) | ✅ | openExternal.ts |
| Misc | Dev-only keyboard shortcuts | ✅ | Cmd+F for search, Cmd+Shift+A dev fallback |
| Misc | Server-side Vikunja version in footer | ❌ | Not implemented |
| Misc | In-app notification inbox | ❌ | `GET /notifications` not wired |

## Easiest next features (quickest to ship)

Ranked by effort × impact, with rationale.

### 1. Inbox view (no-project tasks) — ~0.5 day

Already have the SmartViews scaffold (`TodayView`, `UpcomingView`). An "Inbox" view is a query for tasks where `project_local_id IS NULL`. Add sidebar item, wire through `ActiveView`, reuse `SmartTaskRow`. Zero server changes, pure client-side query. This was promised in SPEC M6 but never shipped.

### 2. Merge the `feat/quick-features` branch into `dev` — ~1 hour

Three commits with real user value already sitting on `feat/quick-features`:
- Checklist progress bar on rows (455096c)
- TipTap checkbox alignment fix (246a1eb)  
- Relative reminders picker (b1eb723)

These are tested, stacked, and conflict-free with `dev`. Merge them now to unblock the stacked PRs (#49, #50, #51, #46).

### 3. Task hover preview popup — ~1 day

A simple tooltip/popover on task rows showing title, due date, assignees, and first few labels. Use an existing Radix tooltip or popover primitive. Low effort, high polish — matches how Linear/Todoist show task peek without opening the detail pane.

### 4. Merge stacked PRs (#49, #50, #51, #46) — ~2 hours each for review + ~1 day total

The four open PRs targeting `feat/quick-features` are small and well-defined:
- **#49**: Inline label creation in the task label picker
- **#50**: `+ProjectName` quick-add syntax + auto-select
- **#51**: NL recurrence parsing (`every day`, `weekly`, `every 3 days`)
- **#46**: Task identifier (PROJ-42) in detail card

Once `feat/quick-features` merges to `dev`, these can rebase and merge quickly. Net gain: 4 features shipped for ~1 day of review + merge effort.
