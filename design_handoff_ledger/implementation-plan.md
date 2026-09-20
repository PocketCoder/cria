# Ledger redesign — implementation plan & checklist

Source of truth: `design_handoff_ledger/README.md` + `Cria - Redesign.dc.html` + `screenshots/`.
All commits target `dev`. Verification: `pnpm typecheck` after each step, `pnpm test` at
end of Steps 1, 2 and final. No Rust/capability changes expected.

**Resolved decisions**
- Notification bell → **pinned to sidebar footer** (not Settings).
- `--color-ring` → **keep a token** (muted slate; light `oklch(58% 0.12 255)` / dark `oklch(60% 0.10 255)`).
- `+n` cap → derive from whatever row fields are cheaply available (labels, repeat, percent, colour); no extra per-row queries.
- New tokens `--color-inverse` / `--color-inverse-foreground`; add `--color-success` / `--color-warning`.

## Checklist

- [x] **Step 1 — Tokens, font swap, delete glass**
  - [ ] `globals.css`: light `@theme` tokens per README; `--radius 0.5rem`; Instrument Sans; keep caption/footnote/micro + spring + ring; add inverse/success/warning
  - [ ] `globals.css`: add group-label utility (11.5px/700/0.11em uppercase)
  - [ ] `globals.css`: delete all `.glass-*`, `--glass-*`, `@property --sheen-angle`, `@keyframes sheen-sweep`, `.scrolled`, `html.native-glass`, `.tab-bar-dock`, `.fab`, `.surface-card` + Todoist grouped-card rules
  - [ ] `package.json`: add `@fontsource-variable/instrument-sans`, remove `plus-jakarta-sans`
  - [ ] `main.tsx`: swap font import; remove `applyNativeGlass` import + call
  - [ ] Delete `src/components/SpecularTracker.tsx` + mount in Shell
  - [ ] Delete `src/tauri/liquidGlass.ts` + `refreshNativeGlassTint` in `ThemeProvider.tsx`
  - [ ] `pnpm typecheck` + `pnpm test`

- [x] **Step 2 — Shared task row + priority ramp + completion animation**
  - [ ] `priority-select.tsx`: replace `PRIORITY_META` (0–2 transparent; 3/4/5 per README)
  - [ ] New `src/features/tasks/TaskRowCore.tsx`: `[priority bar][checkbox][title…][date · project · +n]`
  - [ ] `+n` suppressed-signals popover (Radix Popover, TaskHoverPreview-style content)
  - [ ] Completion animation: opacity 0.45 + strike → 400ms collapse (spring-snappy); keep sound/haptic
  - [ ] Converge `SmartTaskRow` + TaskList `TaskRow` onto TaskRowCore; non-sticky group headings
  - [ ] `pnpm typecheck` + `pnpm test`

- [x] **Step 3 — macOS shell chrome**
  - [x] `ProjectSidebar.tsx`: 236px paper bg; 44px drag strip; search → palette; 30px nav rows; ink selected; uppercase group labels; 7px dots; sync footer + **notification bell pinned in footer** + settings
  - [x] `Shell.tsx`: remove header bar + desktop footer + scrollSentinel; three-column layout; TaskDetail → top-level 372px column; content header (title/date/Filter/Add task); FAB restyle; mobile copy for sync states
  - [x] `pnpm typecheck`

- [x] **Step 4 — Inspector rewrite**
  - [x] `TaskDetail.tsx`: 372px paper column; chrome strip ★⋯✕; identifier; 21px title; chip row; description; subtasks (1/4 + progress + +Add); collapsed rows; Mark done
  - [x] `TaskActions.tsx`: keep handlers, restructure into chips + collapsed rows + More…
  - [x] `pnpm typecheck`

- [x] **Step 5 — iOS shell: TabBar, Browse, Upcoming**
  - [x] `TabBar.tsx`: 4 flat tabs Today/Upcoming/Browse/Search; inbox badge; remove drawer/swipe
  - [x] `ProjectPickerList.tsx` → full Browse screen (pinned rows, chips, headers)
  - [x] `SmartViews.tsx` + `UpcomingCalendar.tsx`: 34px square-ish cells, 11px radius; real agenda headings; merge empty-day runs
  - [x] `pnpm typecheck`

- [x] **Step 6 — Capture, palette, quick add desktop**
  - [x] `QuickAddModal.tsx`: inline token highlight; only-set chips + `+ Priority, labels…`; syntax hint footer; 46px send (mobile); ⇧⏎ add-keep-open; ink Add button
  - [x] `CommandPalette.tsx`: 560px/14px; esc chip; ink selected; priority bar + `project · due`; footer hints + count; ⌘⏎ mark done
  - [x] `pnpm typecheck`

- [x] **Step 7 — Now block**
  - [x] `stores/ui.ts`: `nowTaskIds`/`pickedOn` persisted under `cria:now`; pick/unpick/reset
  - [x] `SmartViews.tsx`: Now block (header, 3 rows, empty state) + `NowPicker` sheet
  - [x] Completion/reschedule removes from array; Re-pick reopens
  - [x] `pnpm typecheck`

- [x] **Step 8 — States + copy**
  - [x] `LoginScreen.tsx`: first-run redesign (44px mark, new copy, 340px URL field, try.vikunja.io link)
  - [x] Sync line copy: All synced/Sending/Offline/wouldn't send/conflict (drop outbox/dead-letter jargon)
  - [x] Nothing-due card + `Pull something forward` (7-day picker)
  - [x] `ConflictModal.tsx`: 440px card, two option cards, ink/outline buttons
  - [x] `pnpm typecheck`

- [x] **Step 9 — Dark mode**
  - [x] `.dark` + media-dark token values per README; inverse pair dark values
  - [x] Dark priority lift (`--prio-*` tokens); checkbox rings + dark tick; Filter outline border; selected-nav-row muted (no invert); shadow→border on overlays; `@custom-variant dark` → `.dark` class. (home indicator: no drawn element exists — OS-native)
  - [x] `pnpm typecheck` + `pnpm test`

- [x] **Final** — `pnpm typecheck` clean; `pnpm test` 715/715 pass; `pnpm build` (vite) OK — dark utilities compile under `.dark`. (Tauri bundle step needs `TAURI_SIGNING_PRIVATE_KEY`; unrelated to this work.)
