# Remaining work

The native iOS and Mac apps are at parity with the Tauri app except for what is listed here. The native-parity work has only been compiled in CI, not run on a device or a Mac.

## Deferred by the user

- Translation / i18n (both apps are English only; no server language setting row).

## Vikunja features not in the native apps

- OpenID Connect / SSO sign-in (blocks SSO-only servers), registration and password reset.
- Import / migration UI (Todoist, Trello, MS To-Do, TickTick, WeKan, Planka, Vikunja export, CSV with column mapping, import progress).
- Time tracking (Vikunja 2.4+; may need a pro licence).
- Project and user webhooks.
- Comment reply with quote and "jump to original", emoji autocomplete, image alt text.
- Task read/unread status (v2 `task_unread_status`).
- `created_by` filter field; audit the rest of `FilterCompiler` against Vikunja's filter fields (saved filters run on device, so a missing field gives different results from Vikunja-web).
- Bot users, MCP tokens/endpoint (2.7), Atom feed for notifications, admin panel.
- Pending email change: resend or cancel.
- Clear stored notifications: Vikunja has no endpoint (only mark read).
- Live sync: the upstream WebSocket only pushes notifications and timers.
- Overview/home page (last viewed projects): replaced by Today by design.

## Todoist-style features not built

- Calendar layout / time blocking, with device calendar events (EventKit).
- Completed-tasks history (logbook) and productivity stats/streaks.
- Configurable project/filter widgets; widgets and share extension on the Mac (no App Group there).
- Mac Services menu ("Add to Cria"), Focus filters, Apple Watch app, task templates, tasks from PDFs or pasted text.
- Live Activities (only the system one for AI background runs exists).
- Siri acting on on-screen items.

## Release / platform

- Mac stable release channel and the Tauri handover (stable Sparkle feed, Tauri outbox gate, credential takeover, parity audit on a real Mac).
- Nothing from the native-parity branch has been run on a device or a Mac; CI is the only check.

## Known limitations of what was built

- Archived projects: opening one only labels it read-only; edits are not blocked locally (the server rejects them).
- Kanban: a collapsed column strip is not a drop target.
- Undo does not cover labels toggled in the detail label sheet or inline chips, completing from the menu bar extra, the reminder notification "Complete" action, or the relations-section done toggle.
- Undoing a reopen sets `done_at` to now; undoing a repeating-task completion does not re-mark subtasks that were reset; Kanban undo restores only the moved card's bucket and position.
- Default due time is not applied to a view's initial due date or to quick-add date presets.
- Mac time stepper for default due time saves on every step (no debounce).
- A task whose cover attachment is deleted keeps a stale cover id until the next pull.
- Quick add follows Vikunja's Quick Add Magic exactly, so the old extras are gone (`yesterday`, `tmrw`, part-of-day words, bare `5pm`, "in N minutes/years", "every monday", "every weekday"); they could return under the expanded-syntax setting.
- Mac palette is not on the shared `PaletteModel` (grouping logic duplicated).
- iPad palette has no Ramble, photo or settings commands; iPad ⌘1 to ⌘3 are fixed to Today, Upcoming and Inbox.
- Mac menu items Teams and New Saved Filter are not hidden for link-share sessions.
- No keyboard "move task up/down" on the Mac.

## Done in the native-parity work

- Archived projects, link-share options, rich-text project description.
- iOS project reorder; Gantt and table row reorder; Gantt arrow keys on Mac.
- Notification bell; task subscribe.
- Kanban column collapse and ⌘-click, kanban cover images, nested kanban subtasks on Mac.
- Upcoming month grid; filter suggestions in view fields.
- Editor slash menu; Mac hover preview, mention popover and inline image open.
- iPad palette and shortcuts.
- Server-synced default due time and default reminders.
- Interactive and lock-screen widgets, plus Control Centre add.
- Wider undo, with ⌘Z on Mac.
- Vikunja Quick Add Magic parity plus an expanded-syntax setting.
- Siri/Shortcuts on Mac with new intents; app icon badge on iOS.
- Settings and menu parity between iOS and Mac.
