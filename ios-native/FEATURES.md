# Cria native iOS: feature reference

Every user-facing feature of the SwiftUI app, and where its data lives. Derived from the code in `CriaApp/` and `CriaKit/` on `feature/swift-ios`; nothing here is taken on trust from the plan. The app is in daily use on an iPhone (iOS 26), which is where it is tested; problems found there are fixed as they come up.

## Where data lives

| Label | Meaning | Storage |
|---|---|---|
| **Vikunja** | On the Vikunja server, so Vikunja-web and every other client sees it. | Local SQLite copy plus an outbox that pushes changes in order. Offline edits queue and send later. |
| **Cria accounts** | Follows the account to other Cria installs. Vikunja-web ignores it. | `settings.frontend_settings.cria` on the server, saved through the v2 merge-patch with a v1 fallback. Keys listed under [Settings](#settings). |
| **This device** | Never leaves this phone. | `UserDefaults` (`PreferencesStore`, `@AppStorage`), the Keychain, the App Group database, or in-memory state. |

Two notes apply throughout:

- Settings that live on the server (`settings.*` and the Quick Add Magic mode) are saved one field at a time and never as a whole object. A few of them are also cached in `UserDefaults` so the app can read them without opening Settings. That copy is a cache, not a separate setting.
- "Online only" means the feature calls the server directly and has no offline queue.

## Tasks and task detail

| Feature | Where it lives | Notes |
|---|---|---|
| Duplicate a task | Vikunja | Task detail ••• menu or a row's long press. Copies dates, priority, progress, colour, repeat, labels and reminders. |
| Postpone (defer) presets | Vikunja | 1 day, 3 days, 1 week, next Monday, from the later of the due date and today. Task detail, row long press and the selection bar. |
| Task colour | Vikunja | `hex_color`; palette or a custom colour. Shown as a dot on rows. |
| Copy link to a task or comment | Vikunja | The server's web address; available once the task has synced. Share from the ••• menu. |
| Row signals | Vikunja | Colour, attachments, checklist n/m, progress and repeats on task rows. |
| Full-size images | This device | Tap an image in a description or comment: zoom, pan, Share or Save. |
| Create, edit, complete, delete task | Vikunja | Offline-safe. Delete holds the push for 7 seconds so the Undo toast can cancel it. |
| Title | Vikunja | Saved when editing ends. |
| Description (rich text) | Vikunja | Stored as HTML. Native editor: bold, italic, underline, strikethrough, heading, bullet, numbered and task lists, indent, quote, code block, link, image, @mention. Sanitised on display. |
| Move to another project, priority | Vikunja | |
| Due, start and end dates | Vikunja | Date-only values are pushed at midnight in the timezone set in Settings. Times can be added and removed. |
| Repeat | Vikunja | Daily, weekly, monthly, yearly, or a custom interval in hours to months; counts from the due date or from completion. |
| Reminders | Vikunja | Absolute, or relative to the due date. The server stores them; the phone alerts are a separate device feature (see [Reminders and notifications](#reminders-and-notifications)). |
| Progress (percent done) | Vikunja | Follows the share of subtasks done, unless set by hand. |
| "Progress set by hand" flag | This device | `ProgressOverride` in `UserDefaults`, keyed by task. Another install may overwrite the value by following subtasks. |
| Favourite (star) | Vikunja | |
| Labels on a task | Vikunja | Pick existing labels or type a new name to create one. |
| Assignees | Vikunja | Searching for people needs a connection. Names seen are cached on this device (`cria.userNames`). |
| Subtasks and relations | Vikunja | Add subtask in place, or relate to any task: subtask, parent, related, blocking, blocked by, duplicates, precedes, follows, copied from. Done toggle on each subtask. |
| Reset subtasks when a repeating task is done | Cria accounts | Customise > Dates & tasks (`resetSubtasksOnRepeat`). The subtask updates themselves go to Vikunja. |
| Order of sections on the task screen | Cria accounts | Settings > Customise > Task layout (`taskDetailOrder`). Title, description and Delete stay fixed. |
| Row swipes, context menu | This device for the menu; Cria accounts for what each swipe does | Complete, Schedule, Star, Delete or None per side (Customise). Context menu adds Due tomorrow and Show or Hide subtasks. |
| Subtask collapse in lists | This device | In memory only; resets when the screen closes. |

## Lists and views

A project opens on its views, taken from Vikunja. Switch between them from the header pills, and manage them from the Manage button.

| Feature | Where it lives | Notes |
|---|---|---|
| View settings | Vikunja | Manage views: title, filter (checked as you type) and, for boards, manual or filter columns. |
| Kanban filter | This device | Text, minimum priority, labels, show done; per board (`cria.kanbanFilter.<view>`). Hides cards only. |
| Gantt date range | This device | From, To, show undated tasks, Reset (`cria.gantt.filters`). |
| Table cell editing | This device for the switch | Options > Edit cells: labels, assignees and dates edit in place. |
| Last view per project | This device | A project opens on the view used last (`cria.projectView.<project>`). |
| Project info | Vikunja | Identifier, parent, open and done counts, owner, dates. From the project header or Browse long press. |
| Duplicate a project | Vikunja | Online only, from Browse long press or the info page. |
| Project views (create, rename, delete, reorder; List, Gantt, Table, Board) | Vikunja | A project keeps at least one view. |
| List view | Vikunja | Subtasks nested under parents. Pull to refresh. |
| List: manual reorder (edit mode) | Vikunja | Per-view task position (`/tasks/{id}/position`). Only offered with the manual sort. |
| Display options (group, sort, filters, show completed) | This device | Per view (each project, label, Favourites, Inbox, Today, Upcoming, saved filter) in `cria.display.configs`. Group by priority, due date, project or label; filter by priority, dates, label, project, assigned to me or unassigned. |
| Select several tasks | Vikunja for the changes | Select beside the title; the bar completes, schedules, defers, moves, sets priority or deletes them together. |
| Kanban cards and columns | Vikunja | Move a card by drag or "Move to" (bucket assignment, position); moves made elsewhere arrive at the next pull. Add, rename, delete columns; set a column limit that blocks drops. Subtasks in their parent's column sit inside its card ("2/3 subtasks"); ones in another column are their own card captioned with the parent. |
| Kanban done and default column | Vikunja | Stored on the view. |
| Kanban for filter views | Vikunja | Read-only by design: each column is a saved search, so a card shows wherever it matches and is not dragged between columns (as in Vikunja-web). |
| Table view | Vikunja for the tasks | Tap a row to open it; swipe to complete. |
| Table: visible columns and sort keys | This device | `@AppStorage` (`cria.tableViewColumns`, `cria.tableViewSortBy`), shared by all tables. Created By shows You, a name or a username. Comments counts come from the server while online (needs a Vikunja with the `comment_count` expand), else from comments already synced to this phone. |
| Gantt | Vikunja for dates | Drag a bar or its edges to change start and end; no-date tasks sit in a tray and can be dragged on or scheduled from today. Relation arrows and a today line are drawn. |
| Gantt: zoom (days or weeks), show done | This device | `@AppStorage` (`cria.gantt.weekZoom`, `cria.gantt.showDone`). |

## Smart views

| Feature | Where it lives | Notes |
|---|---|---|
| Today when everything is done | This device | "Pull something forward" from the next 7 days, and up to three suggestions. |
| Today | Computed on this device from Vikunja tasks | Overdue first, then due today. "Reschedule" moves a group's overdue tasks to today; tasks with a due time keep it. |
| Upcoming | Computed on this device from Vikunja tasks | One section per day, with a week strip. The strip starts on the Vikunja week-start setting. |
| Inbox | Vikunja (the default project) | Open tasks in the default project chosen in Settings. |
| Favourites | Vikunja | Starred tasks. |
| Label list | Vikunja | Tasks carrying one label; counts shown in Browse. |
| Saved filters (create, edit, delete) | Vikunja | Online only. Title, description, query and "include empty values". The query editor highlights fields, operators, values and errors. Results are computed on device from synced tasks. |
| Tab badge counts | This device | Today (due or overdue) and Inbox (open). Off by default; Customise > Navigation. |

## Quick add and Ramble

| Feature | Where it lives | Notes |
|---|---|---|
| Quick add sheet | Vikunja for the task | Parses `*label +project !priority`, assignees, repeats, and dates ("tomorrow 5pm") from the line, with a live preview. Date, priority, reminders and labels are also pickers. Offline adds file into the remembered default project. |
| Quick Add Magic mode (Vikunja, Todoist, Off) | Vikunja | Stored in `frontend_settings.quick_add_magic_mode`, the key Vikunja-web uses. Cached locally in `cria.quickAddMagicMode`. |
| Which chips show in the quick add row, labels on chips | Cria accounts | Customise > Quick Add (`quickAddActions`, `quickAddShowsLabels`). Others move to the ••• menu. |
| Detect dates in the title | Cria accounts | `detectDates`. Off keeps dates as text. |
| "Next week" and "weekend" meaning | Cria accounts | `nextWeekDay`, `weekendDay`. |
| "Keep open after adding" | This device | In memory, per sheet. |
| Suggest subtasks | Vikunja for the subtasks | Task detail > Subtasks. The on-device model proposes an editable checklist; ticked lines become subtasks. Same device requirements as Ramble. |
| Describe a filter | Vikunja for the filter | Saved-filter editor: describe it in words and the on-device model writes the query, retrying once if it does not parse. |
| Ramble (speak or type a list, review, add) | Vikunja for the tasks | Needs iOS 26 on a device with Apple Intelligence; the button is hidden otherwise. The model runs on the device and writes dates in words for the parser to resolve. Speech recognition is on-device. |
| Ramble in the background | This device | Keeps working when you switch apps and notifies when ready (iOS 26). Closing the sheet with rows not yet added asks first. |
| "Let Ramble choose projects and labels" | This device | `rambleChoosesTags` in `LocalPreferences`. Not in the account sync. |
| List from photo (OCR to tasks) | Vikunja for the tasks | Camera or library, Vision text recognition, review and edit, then add. Tidy-up with the on-device model when available. |
| Photo capture defaults (project, label) | This device | Settings > Photo capture (`photoProjectId`, `photoLabel`). |
| Summarise comment thread | Not stored | Shown on the task screen when the model is available and a task has two or more comments. |

## Search

| Feature | Where it lives | Notes |
|---|---|---|
| Search tab | This device | Works offline over the synced copy: FTS5 over task titles and descriptions, plus project, label and saved filter titles. At most 50 tasks. |
| Search filters in the query (`#label`, `!3`, dates, "overdue", "high priority", "soon") | This device | Shown as chips. |
| Spotlight (system search) | This device | Up to 500 open tasks, re-indexed after syncs and edits. Cleared on sign-out. |

## Projects, labels and sharing

| Feature | Where it lives | Notes |
|---|---|---|
| Projects: create, edit, delete | Vikunja | Title, description, colour, parent, archived. |
| Project hierarchy | Vikunja | Parent and child projects, with open task counts. |
| Favourite a project | Vikunja | Swipe right in Browse. |
| Expand and collapse in Browse | This device | `@AppStorage` (`cria.projectTree.collapsed`). |
| Labels: create | Vikunja | From the task label picker, quick add, or Ramble. |
| Labels: browse and filter by label | Vikunja | Browse lists labels with open counts. |
| Labels: rename, recolour, delete | Vikunja | Swipe or long-press a label in Browse, or Edit label on its screen. Queued offline. Delete asks first and removes the label from its tasks. |
| Project background | Vikunja | Shown as a banner on the project screen (cached on this device). Edit project > Background: upload a photo, pick from Unsplash when the server offers it (with credit), or remove. Online only. |
| Share a project with people, teams and links | Vikunja | Online only. Permission per person or team, add and remove, read-only link shares, optional password. Needs the project to have synced first. |
| Teams (create, rename, delete, members, admin toggle) | Vikunja | Online only. Settings > Account > Teams. |
| Subscriptions | Not in the UI | The endpoints exist in `CriaKit`; nothing calls them. |

## Comments and attachments

| Feature | Where it lives | Notes |
|---|---|---|
| Comments: add, edit, delete | Vikunja | Rich text, including @mentions. Pulled when a task opens, not on the 60 second poll. |
| Comment reactions | Vikunja | Six quick emoji. Applied locally first; a failed call is corrected by the next pull. Needs a comment that has synced. |
| Attachments: photo, file, camera, paste | Vikunja | Bytes are held in a local side-store and uploaded from the outbox, so attaching works offline. Pending rows show Queued or Failed. |
| Attachment preview and delete | Vikunja | Preview downloads and opens in Quick Look. Deleting an uploaded file calls the server first, so it needs a connection. |
| Inline images in descriptions and comments | Vikunja | Pending images use `cria://pending/{id}` until upload, then are rewritten to the server URL. Server-hosted images load with the session token. |

## Reminders and notifications

| Feature | Where it lives | Notes |
|---|---|---|
| Reminder actions | Vikunja for Complete | Long-press a reminder notification: Complete (without opening the app) or Snooze 10 minutes. |
| Relative reminders | Vikunja | Any offset before or after the due, start or end date; rows show when they fire. |
| Notifications-off warning | This device | On a task's reminders, with a button to the iOS notification settings. |
| Conflict notification | This device | When a sync finds conflicts while Cria is in the background; it opens the conflict sheet. |
| Task reminders (the data) | Vikunja | See [Tasks](#tasks-and-task-detail). |
| Phone alerts for reminders | This device | Scheduled with the OS (up to 64 pending) so they fire with the app closed. Tapping one opens the task. Permission is asked when there is something to schedule. |
| Notifications master switch | This device | `notificationsEnabled`. Off clears every pending alert Cria scheduled. |
| Morning summary, weekly round-up (on or off, time) | This device | Defaults 08:00 and 09:00. The round-up falls on the Vikunja week-start day. Tapping opens Today. |
| Activity (notifications inbox) | Vikunja | Online only. Mark read, mark all read; tapping opens the item. |
| Email reminders, overdue digest and its time | Vikunja | Settings > Notifications > Email. |

## Offline and sync

| Feature | Where it lives | Notes |
|---|---|---|
| Local database | This device | SQLite in the App Group container `group.io.cria.app`, same schema as the Tauri app. |
| Pull | Vikunja | Every 60 seconds while the app is active, plus pull to refresh and a sync on launch. Projects, saved filters, labels, tasks (with reminders, relations, assignees, attachment records), views and buckets. A fuller reconcile of server deletions runs about every 15 minutes. |
| Outbox | This device, drained to Vikunja | FIFO with exponential backoff (capped at 60 seconds). Offline failures do not use up attempts. After 10 failed attempts an op moves to failed. |
| Sync queue screen | This device | Settings > Sync. Waiting and failed ops; Retry, Retry all, Discard, Discard all, Copy details, Sync now. |
| Sync banner | This device | Shows the current step, offline state, or the last error; tap to retry. |
| Conflicts | Vikunja | Detected on pull and before a push when the server copy changed since the last sync. Sheet shows Yours and Server per field; Keep mine or Use theirs. Task fields compared: title, description, done, dates, priority, percent done, colour, position. Projects: title, description, colour, parent, archived, favourite. Labels: title, description, colour. |
| Undo | This device | Task delete only (5 second toast, 7 second hold in the outbox). |
| Sign in | Vikunja | Server URL plus an API token, or username, password and a two-factor code. |
| Credentials | This device | Keychain. Up to five recent servers show as chips on the login screen; Remember me keeps the username per server (never the password). Signing out with "delete data" forgets usernames but keeps the servers. |
| Sign in with a share link | Vikunja | See Settings below. |
| Sign out | This device | Clears pending alerts and Spotlight, and signals the widget and extensions. |
| Sign out and delete data on this iPhone | This device | Also deletes the database, queued uploads, cached backgrounds, cached account settings, other people's names and temporary files. Warns how many changes have not synced. Device preferences stay. |
| Sign in with a share link | Vikunja | Login > Share link: paste a project's share link (and its password). Account-only settings, the activity inbox, email settings, assigning people, project sharing and new saved filters are hidden. |

## Settings

Settings opens from the gear in Browse.

### General

| Feature | Where it lives | Notes |
|---|---|---|
| Timezone | Vikunja | Also cached on the device and used for pushed all-day dates. |
| Week starts on | Vikunja | Read by the Upcoming strip and the weekly round-up. |
| Default project | Vikunja | Also remembered in the App Group so the share extension and Siri can file tasks offline. |
| Quick Add Magic | Vikunja | See [Quick add](#quick-add-and-ramble). |
| Discoverable by email, by name | Vikunja | |
| Date format, time format | Cria accounts | `dateFormat`, `timeFormat`. Shared with the desktop Cria app. |
| Show completed | This device | `cria.taskList.showDone`: the starting value for views whose Display options have not been changed. |
| Let Ramble choose projects and labels | This device | Only shown when the on-device model is offered. |

### Appearance

| Feature | Where it lives | Notes |
|---|---|---|
| Theme (System, Light, Dark) | Cria accounts | `colorScheme`. Shared with the desktop Cria app. |
| Sound when completing a task | Cria accounts | `playSoundWhenDone`. Shared with the desktop Cria app. |
| Task complete tone | Cria accounts | `completionTone` (six built-in system sounds). |

### Customise

All keys are in `Customisation.syncedKeys`. Vikunja-web and the desktop Cria app ignore them.

| Feature | Where it lives | Notes |
|---|---|---|
| Tab bar (up to three of Inbox, Today, Upcoming, Favourites; Browse and Search are fixed) | Cria accounts | `tabs`. |
| Home view (the tab Cria opens on) | Cria accounts while "Sync home view" is on, else this device | `homeView` travels only while `syncHomeView` is on. Turning sync on shares this device's choice. |
| Sync home view switch | This device | `syncHomeView` is never synced. |
| Show task count | Cria accounts | `showTaskCount`. |
| Swipe right, swipe left | Cria accounts | `swipeRight`, `swipeLeft`. |
| Quick add actions and labels, date detection, next week, weekend | Cria accounts | See [Quick add](#quick-add-and-ramble). |
| Reset subtasks on repeat | Cria accounts | `resetSubtasksOnRepeat`. |
| Open web links in Cria or the browser | Cria accounts | `openLinksInApp`. Opens a Safari view inside the app when on. |
| Task layout | Cria accounts | `taskDetailOrder`; drag to reorder, Reset to default. |

### Notifications and photo capture

| Feature | Where it lives | Notes |
|---|---|---|
| Notifications, morning summary, weekly round-up, times | This device | See [Reminders and notifications](#reminders-and-notifications). |
| Photo capture default project and label | This device | |

### Account

| Feature | Where it lives | Notes |
|---|---|---|
| Display name | Vikunja | |
| Avatar source (Default, Initials, Gravatar, Marble, Upload) and upload | Vikunja | Online only. Photos are re-encoded to JPEG. |
| Email address change | Vikunja | Needs the current password; the server may ask to confirm by email. |
| Change password | Vikunja | Ends all sessions; the app signs out afterwards. |
| Two-factor authentication (QR code, secret, confirm, turn off) | Vikunja | Online only. |
| Sessions (list, revoke) | Vikunja | Online only. Older servers without the route get a message. |
| API tokens (create with route permissions and expiry, delete) | Vikunja | Online only. The token text is shown once. |
| CalDAV tokens | Vikunja | Settings > Account > CalDAV: the address to use, create (token shown once) and delete. Online only. |
| Data export (request, download, share) | Vikunja | Online only. ZIP from the server. |
| Account deletion (request, cancel) | Vikunja | The server emails a confirmation link; nothing is deleted or signed out until it is followed. |
| Storage: cached project backgrounds (count, clear) | This device | The cache can be cleared here. |
| About (version, server) | This device | |

## Platform

| Feature | Where it lives | Notes |
|---|---|---|
| Today widget (small, medium) | This device | Reads the shared database read-only: up to five open tasks due today or overdue. Refreshes after syncs and edits, every 30 minutes, and at midnight. Shows a sign-in prompt after sign-out. |
| Share extension | Vikunja for the task | A shared link or text becomes a task in the default project. It is written to the shared database and pushed the next time the app syncs. |
| Siri and Shortcuts: "Add task" | Vikunja for the task | Phrases "Add a task in Cria" and "New Cria task". Same capture path as the share extension. |
| Deep links | This device | `cria://task/{id}`, `cria://project/{id}`, `cria://today`, `cria://upcoming`, `cria://inbox`, `cria://search`, `cria://add?title=...`. A numeric id is a server id; anything else is a local id for this device only. |
| Spotlight | This device | See [Search](#search). Results open the task. |
| Navigation | This device | iOS 18 and later use the system `TabView` (a separate Search tab on iOS 26); iOS 17 uses plain tab items. State is kept per tab. |

## Known gaps

- **English only.** There is no language setting: the interface is not translated. The account's language stays as set on the server (Vikunja-web and emails use it).
- **Polling only.** No WebSocket live sync, and no network-reachability trigger; the 60 second tick and the outbox cover reconnects.
- **Link-share sessions end when the token expires.** A share token cannot be refreshed, so the app signs out when it runs out.
