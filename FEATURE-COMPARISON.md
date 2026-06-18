# FEATURE-COMPARISON.md — Cria vs Vikunja

Last updated: Tue Jun 16 2026

## Legend
| Icon | Meaning |
|---|---|
| ✅ | Shipped (in `dev`) |
| 🟡 | Partial (UI present / persisted, but behavior not yet wired) |
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
| Tasks | **+ProjectName in quick-add** | ✅ | Shipped via feat/quick-features merge |
| Tasks | **NL recurrence in quick-add (every day/week etc.)** | ✅ | Shipped via feat/quick-features merge |
| Tasks | **Task identifier (PROJ-42) in detail card** | ✅ | Shipped via feat/quick-features merge |
| Tasks | **Checklist progress bar on rows** | ✅ | Shipped (countChecklistItems + tabular display in TaskList) |
| Tasks | **Task-list checkbox alignment + persistence in TipTap** | ✅ | Shipped (TaskList extension + inline checkbox persistence in RichTextEditor) |
| Tasks | Sub-tasks tree (indented + collapsible) | ✅ | M8 (#45), via task relations `subtask` kind |
| Tasks | Sub-task promote/demote | ✅ | M8 (#45) |
| Tasks | Related tasks panel (11 relation kinds) | ✅ | M8 (#45), RelatedTasks in detail card |
| Tasks | Recurrence (repeat_after/repeat_mode) | ✅ | M8 (#45), UI picker in TaskActions |
| Tasks | Task detail floating card | ✅ | Right-docked card, Escape to close |
| Tasks | Assignees (add/remove) | ✅ | Via TaskActions + user picker |
| Tasks | Labels (apply/remove) | ✅ | Via TaskActions + LabelChips |
| Tasks | **Inline label creation when adding labels** | ✅ | Shipped (createLabel + toggleTaskLabel in TaskActions) |
| Tasks | Favorites (is_favorite) | ✅ | Star toggle in TaskActions |
| Tasks | Description WYSIWYG editor (TipTap) | ✅ | Full TipTap with slash commands, images, links |
| Tasks | Copy task link/identifier | ✅ | Copy icon in detail header — copies server URL or falls back to title |
| Tasks | Bulk operations (multi-select, batch actions) | ❌ | Not started |
| Tasks | Hover preview popup | ✅ | Shipped (TaskHoverPreview component, 800ms delay, shows description/labels/due/priority) |

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
| Labels | **Inline label creation when adding to task** | ✅ | Shipped (TaskActions inline create) |
| Labels | Label manager modal | ✅ | Full create-as-you-type |

### Smart Views

| Category | Feature | Status | Notes |
|---|---|---|---|
| Smart Views | Today (overdue + due today) | ✅ | `TodayView` in SmartViews |
| Smart Views | Upcoming (next 7 days, grouped by day) | ✅ | `UpcomingView` in SmartViews |
| Smart Views | Favorites (favorited tasks) | ✅ | `FavoritesView` in SmartViews |
| Smart Views | Label tasks (per-label) | ✅ | `LabelView` in SmartViews |
| Smart Views | Inbox (tasks without a project) | ✅ | Shipped (InboxView component, defaultProjectId from user settings — #52) |
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
| Reminders | **Relative reminders ("1h before due")** | ✅ | Shipped (ReminderList with presets, custom relative, and absolute modes — RELATIVE_REMINDER_PRESETS) |
| Reminders | Desktop notifications (plugin-notification) | ✅ | Shipped |
| Reminders | macOS Dock badge | ✅ | Shipped |
| Reminders | Reminder scheduler | ✅ | Shipped |
| Reminders | Notifications disabled gate + system-settings link | ✅ | Shipped |

### Comments

| Category | Feature | Status | Notes |
|---|---|---|---|
| Comments | Read comments on task | ✅ | Collapsible section with read/unread tracking |
| Comments | Write/create/update/delete comments | ✅ | Full outbox-backed CRUD |
| Comments | Emoji reactions | ✅ | Phase 3, inline badges + picker, fire-and-forget API |
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
| Native | SQLite with migrations (14 migrations) | ✅ | 001–014, forward-only |
| Native | Single instance (Tauri plugin) | ✅ | plugin-single-instance |
| Native | macOS Dock badge (reminder count) | ✅ | In queries/badge.ts |
| Native | Global shortcut (Cmd+Shift+A → quick add) | ✅ | tauri/globalShortcut.ts |
| Native | Autostart (toggle in footer) | ✅ | tauri/autostart.ts |
| Native | Auto-updater (Tauri plugin) | ✅ | tauri/updater.ts, release workflow |
| Native | Deep links (vikunja://task|project) | ✅ | Shell.tsx handles `tauri://url` |
| Native | Dev/release side-by-side (identifier isolation) | ✅ | tauri.dev.conf.json |
| Native | Notifications (plugin-notification) | ✅ | tauri/notification.ts |
| Native | Tray icon | ✅ | Show window / Quick Add / Quit menu; toggle in settings |
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
| UI | Cmd+K command palette | ✅ | CommandPalette (views, projects, labels, tasks, actions) |
| UI | Per-row keyboard shortcuts (j/k, e, d, l, p) | ❌ | Removed from scope |
| UI | Rebindable shortcuts in settings | ❌ | Removed from scope |
| UI | Settings page (date format, time format, color scheme, name, reminders, notification, tray, autostart) | ✅ | SettingsModal with 6 sections; locale prefs (language/timezone/week start) removed pending local wiring — #76 / #77 / #78 |
| UI | Inbox view (no-project tasks) | ✅ | Shipped |
| UI | Kanban view | ✅ | M9, drag-reorder, WIP bucket limit |
| UI | Table view (dense, sortable) | ✅ | M9, sortable columns, drag-reorder |
| UI | Gantt view | ✅ | M9, timeline with dependency arrows, hide completed toggle |
| UI | Drag-to-reorder tasks | ✅ | M9, list/kanban/table/gantt |
| UI | Drag-to-reorder projects in sidebar | ❌ | Not started |
| UI | Recent projects in sidebar | ❌ | Not started |
| UI | Task hover preview popup | ✅ | Shipped |

### Settings & Configuration

| Category | Feature | Status | Notes |
|---|---|---|---|
| Settings | User preferences (language, timezone, week start) | ❌ | Controls removed from the pane — synced to server but had no local effect; tracked in #76 (timezone), #77 (week start), #78 (language/i18n) |
| Settings | Date format / time format preference | ✅ | Drives full date/time displays (reminders, conflict timestamps, task add + detail date pickers) via lib/dateFormat; dense list rows keep the compact 'd MMM' style; timezone tracked in #76 |
| Settings | Week start (local rendering) | ❌ | Control removed; "this week" logic still hardcodes Monday — tracked in #77 |
| Settings | Account info display | ✅ | Shows name in header |
| Settings | Display name editing | ✅ | Account section input, synced to server |
| Settings | Autostart toggle | ✅ | SettingsModal Advanced section |
| Settings | Sign out | ✅ | SettingsModal Account section |
| Settings | Global shortcuts config | ❌ | Read-only display; rebindable removed from scope |
| Settings | Appearance (color scheme) | ✅ | SettingsModal Appearance, light/dark/system |
| Settings | Play sound on task completion | ✅ | SettingsModal Appearance toggle; Web Audio chime on user-initiated completion |
| Settings | Tray icon toggle | ✅ | SettingsModal Advanced, invokes `set_tray_visible` |
| Settings | Notification toggle (desktop) | ✅ | SettingsModal Notifications, with OS permission gate |
| Settings | Email reminders (server) | ✅ | SettingsModal General toggle, server-synced |
| Settings | Overdue task email reminders | ✅ | SettingsModal General toggle + time picker, server-synced |
| Settings | CalDAV link | ✅ | SettingsModal Advanced, opens docs URL |

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
| Misc | CalDAV docs link in settings | ✅ | Link shown in SettingsModal Advanced section |
| Misc | Webhook management UI | ❌ | Server endpoints exist, no UI |
| Misc | External-link handling (opens in OS browser) | ✅ | openExternal.ts |
| Misc | Dev-only keyboard shortcuts | ✅ | Cmd+F for search, Cmd+Shift+A dev fallback |
| Misc | Server-side Vikunja version in footer | ✅ | Shown in footer via useServerVersion |
| Misc | In-app notification inbox | ❌ | `GET /notifications` not wired |

## Easiest next features (quickest to ship)

Ranked by effort × impact, with rationale.

### 1. Saved filters (Vikunja filter DSL) — ~1 day

SmartViews scaffold exists (TodayView, UpcomingView, InboxView). Saved filters require:
- Fetching saved filters from server (`GET /filters`)
- A sidebar item listing them
- Wiring each filter's query through to the task list
- A save-current-view-as-filter button
Server endpoints exist. Pure client-side UI work.

### 2. Comments (read-only) — ~0.5 day

Vikunja supports comments on tasks via `GET /tasks/{id}/comments`. Read-only display in the detail card is a simple list component. No write/mentions needed for V1.

### 3. Bulk operations (multi-select, batch actions) — ~1.5 days

Multi-select via Cmd+click / Shift+click on task rows, then batch actions (delete, move, set labels). Leverages existing mutation functions in db/tasks.ts.


