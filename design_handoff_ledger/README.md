# Handoff: Cria "Ledger" redesign

## Overview

A visual and UX redesign of **Cria** (Tauri 2 + React 18 + TypeScript + Tailwind v4 client for Vikunja), covering the macOS three-pane shell and the iOS single-pane shell. Codename **Ledger**: ink on warm paper, no glass, structure from whitespace and weight rather than hairlines and chrome.

It resolves six specific problems in the current build:

| Problem today | Ledger's answer |
|---|---|
| No "what should I do now" moment | A **Now** block at the top of Today — up to three user-picked tasks |
| Browse hides projects behind a bottom sheet | Browse becomes a **real tab screen** with its own scroll + search; Inbox pinned at top with its badge |
| Task detail is 15 shouting uppercase buttons | Summary header (title → chips → description → subtasks) + a quiet collapsed row list |
| Priority renders as `!!!!!` | A 3px colour bar on the row edge; a word + swatch everywhere else |
| Row metadata is a soup of chips, dots, bangs and icons | Hard cap: **date · project · +n**. `+n` expands on tap/hover |
| Completing a task gives almost no feedback | Row strikes, fades and springs out; the section count ticks down |

## About the design files

The files in this bundle are **design references created in HTML** — static prototypes showing intended look and behaviour. They are **not** production code to copy. The task is to recreate them inside Cria's existing environment: React 18 function components, Tailwind CSS v4 with the `@theme` token block in `src/styles/globals.css`, Radix UI primitives, `lucide-react` icons, and the existing Zustand + TanStack Query data layer. Keep every existing hook, query and DB call; this is a presentation-layer change plus two small new pieces of state.

## Fidelity

**High fidelity.** Colours, type sizes, spacing and radii below are final and should be matched. Where a value isn't stated, keep what the codebase already does.

---

## Design tokens

Replace the light-theme block in `src/styles/globals.css`. Dark mode is specified below.

```css
@theme {
  --font-sans: "Instrument Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --radius: 0.5rem;                     /* was 0.625rem */

  --color-background:        oklch(97.5% 0.006 85);   /* warm paper — the app canvas */
  --color-card:              oklch(100% 0 0);          /* pure white — content pane, sheets */
  --color-foreground:        oklch(22% 0.012 265);     /* ink */
  --color-card-foreground:   oklch(22% 0.012 265);
  --color-muted:             oklch(93.5% 0.006 85);    /* sidebar search field, hover wash */
  --color-muted-foreground:  oklch(50% 0.012 265);     /* ALL secondary text. Never lighter. */
  --color-border:            oklch(91% 0.006 85);      /* hairline */
  --color-input:             oklch(97.5% 0.006 85);

  --color-primary:           oklch(46% 0.11 255);      /* slate blue — links, progress, Now label */
  --color-primary-foreground:oklch(99% 0 0);
  --color-accent:            oklch(46% 0.11 255);
  --color-accent-foreground: oklch(99% 0 0);

  --color-destructive:       oklch(55% 0.20 25);
  --color-success:           oklch(62% 0.14 150);
  --color-warning:           oklch(74% 0.13 85);
}
```

### Priority ramp

Replace `PRIORITY_META` in `src/components/ui/priority-select.tsx`:

```ts
export const PRIORITY_META = [
  { value: 0, label: 'None',     color: 'transparent' },
  { value: 1, label: 'Low',      color: 'transparent' },
  { value: 2, label: 'Medium',   color: 'transparent' },
  { value: 3, label: 'High',     color: 'oklch(74% 0.13 85)'  },
  { value: 4, label: 'Urgent',   color: 'oklch(65% 0.17 45)'  },
  { value: 5, label: 'Critical', color: 'oklch(55% 0.20 25)'  },
] as const;
```

Rule: **priority 0–2 renders nothing at all.** Absence is the signal. Only 3–5 get a colour.

### Typography

One family — **Instrument Sans** (Google Fonts; ship via `@fontsource/instrument-sans` the same way Plus Jakarta is bundled today, so it stays offline-capable).

| Role | macOS | iOS |
|---|---|---|
| Screen title | 32px / 600 / -0.035em | 34px / 600 / -0.035em |
| Section heading (Today, Tomorrow) | 16px / 600 / -0.02em | 16px / 600 / -0.02em |
| Group label (OVERDUE, PROJECTS) | 11.5px / 700 / 0.11em / uppercase | 11.5px / 700 / 0.11em / uppercase |
| Task title | 14.5px / 400 | 16px / 400 |
| Task title in Now block | 14.5px / 500 | 16px / 500 |
| Row metadata | 12px | 13px |
| Inspector body | 13.5px / 1.6 | — |

Minimum secondary-text colour is `--color-muted-foreground` (`oklch(50% …)`). Nothing lighter — including inactive tab-bar labels. This was measured: anything above ~54% lightness fails WCAG AA at these sizes.

### Density

Adaptive, driven by the existing `useIsMobile()`:

| | macOS | iOS |
|---|---|---|
| Task row height | 40px (`py-2.5`) | 48px (`py-3.5`) |
| Row horizontal padding | 4px inside a 40px-padded pane | 0 inside a 20–22px-padded scroller |
| Checkbox | 17px | 22px |
| Sidebar / list nav row | 30px | 48px |

### Radii, shadows, motion

- Radii: 7px chips · 8–9px buttons and sidebar rows · 11px iOS list fields · 14px cards and the Now block · 18–22px iOS sheets.
- **No `box-shadow` on content.** The only shadows in the system: the iOS bottom sheet (`0 -10px 34px -14px rgba(0,0,0,0.4)`), the iOS FAB (`0 8px 22px -6px rgba(0,0,0,0.4)`), and macOS overlay panels (`0 24px 60px -16px rgba(0,0,0,0.4)`).
- Motion is restrained. Keep the existing `--spring-snappy: cubic-bezier(0.32, 0.72, 0, 1)`, keep sheet/pull-to-dismiss gestures exactly as they are, and honour `prefers-reduced-motion` as the file already does.

---

### Dark mode

Not an inversion. The paper/pane relationship is preserved — the content pane still sits **lighter** than the canvas. Replace the `.dark` block and the `@media (prefers-color-scheme: dark)` block in `globals.css`:

```css
.dark {
  --color-background:        oklch(17% 0.008 265);   /* canvas · sidebar */
  --color-card:              oklch(21% 0.008 265);   /* content pane · sheets · tab bar */
  --color-foreground:        oklch(94% 0.004 85);
  --color-card-foreground:   oklch(94% 0.004 85);
  --color-muted:             oklch(25% 0.008 265);   /* Now block · chips · hover · selected row bg */
  --color-muted-foreground:  oklch(70% 0.008 265);
  --color-border:            oklch(29% 0.008 265);
  --color-input:             oklch(25% 0.008 265);

  --color-primary:           oklch(72% 0.12 255);
  --color-primary-foreground:oklch(18% 0.008 265);
  --color-accent:            oklch(72% 0.12 255);
  --color-accent-foreground: oklch(18% 0.008 265);

  --color-destructive:       oklch(70% 0.16 25);
  --color-success:           oklch(72% 0.13 150);
  --color-warning:           oklch(80% 0.12 85);
}
```

Chroma stays at 0.008 on every neutral — a cool charcoal, not a warm one. Warm greys go muddy at these lightnesses, even though the light theme's paper is warm (hue 85).

**Priority ramp lifts** (needs a dark variant of `PRIORITY_META`, or a pair of CSS custom properties the component reads):

| Level | Light | Dark |
|---|---|---|
| High (3) | `oklch(74% 0.13 85)` | `oklch(80% 0.12 85)` |
| Urgent (4) | `oklch(65% 0.17 45)` | `oklch(72% 0.16 45)` |
| Critical (5) | `oklch(55% 0.20 25)` | `oklch(66% 0.19 25)` |

**Three rules change in dark:**

1. **Ink fill inverts.** Every ink-filled element in light mode — `Add task`, `Mark done`, the FAB, the selected command-palette row, the `add` key — becomes `oklch(92% 0.004 85)` with `oklch(18% 0.008 265)` text. Use a `--color-inverse` / `--color-inverse-foreground` token pair rather than hardcoding, so the same component works in both themes.
2. **Selected nav rows do NOT invert.** A full light fill in a sidebar is far too loud. Selected smart-view rows get `--color-muted` (`oklch(30% 0.012 265)` if you want them a touch stronger) plus `font-weight: 500`. This is the one place the light and dark treatments genuinely differ in kind.
3. **Shadows stop working.** Overlay panels (command palette, quick add, iOS sheets) swap their drop shadow for a `1px solid oklch(34% 0.008 265)` border plus a deeper, wider scrim.

**Values that are not simply the muted token:**

- Checkbox rings: `oklch(48% 0.008 265)`. At the muted-foreground value (70%) an empty checkbox reads as filled.
- Completed rows: accent-filled circle with a **dark** tick (`oklch(18% 0.008 265)`), not white.
- iOS home indicator: `oklch(60% 0.008 265)`, not `#000` — it vanishes on OLED.
- The `Filter` outline button borders at `oklch(31% 0.008 265)`; `--color-border` at 29% is too faint for an interactive edge.

Contrast: `--color-muted-foreground` at `oklch(70%)` on the `oklch(21%)` pane measures ~8:1, so the 10.5–13px secondary text is comfortably AA. Do not drop it below ~62%.

Keep the existing three-way setting (system / light / dark) and the `.light` / `.dark` class mechanism already in `globals.css` — only the values change.

---

## What to delete

This is most of the work, and it's subtractive. In `src/styles/globals.css`, remove:

- Every `.glass-*` rule — `.glass-surface`, `.glass-nav`, `.glass-specular`, `.glass-sheen-animate`, `.glass-refract`, the `--glass-*` tokens, `@property --sheen-angle`, `@keyframes sheen-sweep`, and the `.scrolled` variants.
- The whole `html.native-glass` block.
- `.tab-bar-dock` (the floating capsule) — the tab bar becomes a flat opaque bar.
- `.fab` — replaced by an ink-filled circle with a plain shadow.
- `.surface-card` and the Todoist-style grouped-card rules.

Then delete `src/components/SpecularTracker.tsx` and its mount in `Shell.tsx`, and delete `src/tauri/liquidGlass.ts` plus its call sites. The native macOS glass plugin work goes away entirely — which also closes the desktop-bleed bug the code comments describe.

`.task-check`, `.hover-reveal`, `.chip-reveal`, `.safe-*`, `.inset-list`, the scrollbar rules and the TipTap task-list fix all stay.

---

## Screens

### 1. macOS shell — `src/features/shell/Shell.tsx`

Three columns, no top header bar, no bottom status bar.

- **Sidebar, 236px, `--color-background`.** 44px traffic-light strip at top (drag region — keep `handleHeaderMouseDown`, just move it onto this strip). Then a search field (`--color-muted`, 8px radius, 6px/10px padding, 13px, with a `⌘K` hint) that opens the command palette rather than filtering inline. Then the smart views (Today / Upcoming / Inbox) as 30px rows with count on the right; the selected row is **filled ink** (`--color-foreground` background, white text, 8px radius) — not a grey wash. Then `PROJECTS` and `LABELS` groups, 10.5px/600/0.1em uppercase labels, rows with a 7px colour dot and a count. Sub-projects indent by 14px. Footer: a single 11.5px sync line with a 6px status dot.
- **Content pane, flex-1, `--color-card`, `border-radius: 12px 0 0 12px`** with a 1px left edge. This rounded white pane floating on the paper canvas is the signature of the direction. Header: 44px top padding, 32px title, date subtitle, then `Filter` (outline) and `Add task` (ink-filled) on the right. Body scrolls with 40px horizontal padding.
- **Inspector, 372px, `--color-background`, 1px left border.** Detailed below.

The existing search input, notification bell, `+`, display-options and Sign-out controls move: search and quick-add into the sidebar/palette, the rest into the inspector's overflow and Settings. Remove the desktop `<footer>` entirely and move sync state into the sidebar footer (copy below).

### 2. Today — `src/features/smart-views/SmartViews.tsx`

Section order: **Now** → Overdue → Today → completed (inline, 45% opacity, struck).

**The Now block** is the one genuinely new feature.

- Container: 14px radius, `--color-background` fill, 18px/20px padding, 34px bottom margin. On iOS: 18px radius, full-bleed inside the 20px scroller padding.
- Header row: `NOW` in 12px/700/0.11em uppercase `--color-primary`; "three things, then stop" in 12px muted; a text-button "Re-pick" on the right.
- Up to three rows, each: 3px priority bar · checkbox · title at weight 500 · project name right-aligned.
- **State:** a new `nowTaskIds: string[]` (max 3) in `src/stores/ui.ts`, persisted to localStorage under `cria:now`, plus `pickedOn: string` (a `yyyy-MM-dd` day key). If `pickedOn` isn't today, the block renders its empty state: *"Pick up to three things for today"* with a **Pick** button that opens a checklist sheet over today's tasks. Completing or rescheduling a task removes it from the array. No server round-trip — this is local, device-scoped UI state.
- "Re-pick" reopens the same sheet.

**Task row** (`SmartTaskRow` and `TaskRow` in `TaskList.tsx` — they should converge on one shared component):

```
[3px priority bar] [checkbox] [title ......... ] [date] [project] [+n]
```

Everything after the title is 12px `--color-muted-foreground`, right-aligned, in that fixed order. Overdue dates take `--color-destructive`. The `+n` is a count of the *suppressed* signals (labels, attachments, checklist progress, repeat, percent-done, colour dot) and reveals them in a popover on click — reuse the existing `TaskHoverPreview`. Drop the inline `LabelChips`, `Paperclip`, `RefreshCw`, `CheckSquare`, progress-bar and `hexColor` dot from the row entirely; they live behind `+n` now. Delete the `!`.repeat() priority span.

Group headings become 11.5px/700/0.11em uppercase — Overdue in `--color-destructive`, everything else in `--color-muted-foreground` — and they **stop being sticky and stop having borders**; the whitespace above them does the work.

**Completion feedback:** on check, animate the row `opacity: 1 → 0.45`, strike the title, then after 400ms collapse `height`/`margin` to 0 with `--spring-snappy` and decrement the section count. Keep `playCompletionSound()` and `impactComplete()`.

### 3. Inspector — `src/features/task-detail/TaskDetail.tsx` + `TaskActions.tsx`

This is the biggest rewrite. `TaskActions.tsx` currently renders ~15 `ActionButton`s at `text-xs font-semibold uppercase tracking-wide` in four sections. Replace with, top to bottom:

1. 44px chrome strip, right-aligned: favourite ★, overflow ⋯, close ✕. No title in the strip.
2. Identifier — 10.5px monospace, 0.08em tracking, muted.
3. Title — 21px/600/-0.025em/1.28, click to edit inline (keep the existing behaviour).
4. **Chip row** — the four things you change most, as 7px-radius white chips with a 1px border, 5px/10px padding, 12.5px: project (colour dot), due date (calendar icon), priority (3px colour bar + word), each label (colour dot). Then a dashed `+ Add` chip. Each opens the existing Radix popover picker. This replaces the Priority / Colour / Labels / Set due date / Set start date / Set end date buttons.
5. Description — 13.5px/1.6, the existing TipTap editor, no `DESCRIPTION` heading.
6. **Subtasks** — heading + `1 / 4` + an inline 3px progress track, then the child rows with 15px checkboxes and an `+ Add subtask` row. Sourced from the existing `RelatedTasks` subtask relations.
7. **Collapsed rows** — a 1px top border then five 13.5px rows, each `icon · label · value`: Reminders (`30 min before`), Attachments (`1`), Comments (`2`), Repeat (`Never`), and `More…` with a muted hint `progress · move · duplicate`. Tapping expands in place. Delete, Subscribe, Assignees, Move, Duplicate, Progress and Colour all live under `More…`.
8. **`Mark done`** — full-width ink-filled button at the bottom, 9px radius, 11px padding.

Nothing in the inspector is uppercase except the two group labels. Remove `SectionHeader`, `SectionDivider` and the `text-xs font-semibold uppercase tracking-wide` `ActionButton` styling.

### 4. iOS shell

**Tab bar** — `src/features/shell/TabBar.tsx`. Four tabs: **Today · Upcoming · Browse · Search**. Flat, opaque `--color-card`, 1px top border, `padding: 8px 12px calc(env(safe-area-inset-bottom) + 30px)`. 22px icons, 10.5px labels; active is `--color-foreground` at weight 600 with `stroke-width: 2`, inactive is `--color-muted-foreground`. Inbox leaves the tab bar and becomes a pinned row in Browse — its unread count moves to a badge on the Browse tab.

Delete the bottom-sheet drawer and its swipe-to-dismiss handler from this file; the gesture code moves nowhere, Browse is now a route.

**Browse** — promote `ProjectPickerList.tsx` to a full screen. 34px large title, an 11px-radius search field, then three pinned 48px rows (Inbox with an ink-filled count pill, Favourites, Filters) separated by hairlines, then `PROJECTS` (colour dot, title, count, 32px indent for children, chevron only where there are children) and `LABELS` **as a wrapping chip row** — 10px radius, `--color-background` fill, 9px/13px padding, 14.5px, colour dot. Each group header gets a `+` on the right.

**Upcoming** — `SmartViews.tsx` + `UpcomingCalendar.tsx`. Keep the swipeable week strip and the expand-to-month grid. Restyle: 34px day cells with **11px radius** (not circles), today is an ink-filled square-ish tile, dot indicator is `--color-primary`. Below, agenda days use **real 16px/600 headings** — "Today / Sun 2 Aug / 2" — separated by a hairline `border-top`, not sticky uppercase strips. Runs of consecutive empty days **collapse into a single muted line**: `Wed – Thu · 5–6 Aug · nothing scheduled`. This is a change to `upcomingSectioner()`: post-process the group array, merging adjacent zero-length groups.

**FAB** — 56px, `--color-foreground` fill, white `+`, `bottom: calc(env(safe-area-inset-bottom) + 74px)`, `right: 20px`.

### 5. Capture — `src/components/QuickAddModal.tsx` (mobile branch)

The current sheet shows five picker pills before the user has typed anything. Replace with:

- 22px top radius, white, 10px top padding, 38px grab handle.
- Title field: 21px/500/1.35/-0.015em. **Parsed tokens are highlighted inline** — `--color-primary` text on `oklch(95% 0.02 255)` with a 5px radius — as `parseQuickAdd()` recognises them. This replaces the separate `QuickAddPreview` component.
- One 15px muted "Add a note…" line.
- **Chips show only what is actually set**, plus one dashed `+ Priority, labels…` chip that opens the rest in a popover. Set chips are 9px radius on `--color-background`, 8px/12px, 13.5px/500.
- Footer: a 12.5px syntax hint (`+project` `*label` `!2`, tokens in `--color-primary` monospace) on the left; camera and a 46px ink-filled send button on the right. Keep the `visualViewport` keyboard-inset lift and the top-84px swipe-to-dismiss zone exactly as written.

### 6. Command palette — `src/components/CommandPalette.tsx`

560px wide, 14px radius, white on a `oklch(22% 0.012 265 / 0.34)` scrim, 70px from the top. Search row with a magnifier and an `esc` chip. Results grouped with 10.5px/700/0.11em uppercase labels. **Task rows carry their priority bar and a right-aligned `project · due`**, so the palette works as triage. The selected row is **filled ink**, white text. Footer bar (`--color-background`, 1px top border, 11.5px): `↑↓ navigate · ⏎ open · ⌘⏎ mark done`, result count on the right. Add the `⌘⏎` handler — it calls the existing `updateTask(id, { done: true })` without leaving the palette.

### 7. Quick add, desktop — `QuickAddModal.tsx` (desktop branch)

Same 560px panel and the same type-then-resolve grammar as capture: 19px title with inline highlighted tokens, resolved chips below, footer showing `⏎ add · ⇧⏎ add & keep open · esc cancel` and an ink `Add task` button. Add the `⇧⏎` shortcut (submit, clear the field, keep focus) — it doesn't exist today.

### 8. States

**First run** — `src/features/login/LoginScreen.tsx`. Centred on paper: a 44px ink rounded-square mark, a 24px/600 heading *"Point Cria at your Vikunja"*, a 14.5px explainer — *"Everything is stored on your machine and synced in the background. Works offline from the first launch."* — a 340px URL field, an ink Continue button, and a 12.5px `Use try.vikunja.io` link.

**Nothing due** — a 14px-radius `--color-background` card inside Today: *"Nothing left today."* / *"Six done. Next thing is Tuesday."* / an outline `Pull something forward` button that opens the same picker as the Now block, scoped to the next 7 days.

**Sync** — one 12.5px row in the sidebar footer, no modal unless asked for. Rewrite the copy; the current strings leak implementation:

| State | Dot | Copy |
|---|---|---|
| Idle | `--color-success` | `All synced` + `2m ago` |
| Draining outbox | `--color-primary` | `Sending 3 changes…` |
| Offline | `--color-warning`, white row fill | `Offline — 3 saved locally` |
| Dead letters | `--color-destructive` on `oklch(96% 0.03 25)` | `2 changes wouldn't send` + `Review` |
| Conflicts | `--color-destructive` on `oklch(96% 0.03 25)` | `1 conflict` + `Resolve` |

Drop "pending mutations", "outbox", "dead letter" and "syncing…" from all user-facing strings. Keep them in logs.

**Conflict** — `src/components/ConflictModal.tsx`. 440px card, 17px/600 heading *"This task changed in two places"*, a plain-language explainer, then two option cards — yours (2px `--color-primary` border, `YOURS · EDITED 14:02`) and the server's (1px hairline) — each summarising the differing fields in one 14px line. Two buttons: ink `Keep mine`, outline `Keep server's`. No field-by-field diff.

---

## Suggested order of work

1. Tokens + font swap + delete the glass layer. The app will look 80% right immediately.
2. Task row: priority bar, `+n` metadata cap, completion animation. One shared component for `TaskList` and `SmartViews`.
3. macOS shell chrome: sidebar, rounded content pane, kill the header and footer bars.
4. Inspector rewrite (the long one).
5. iOS: tab bar → 4 tabs, Browse as a screen, Upcoming headings and empty-day collapsing.
6. Capture + palette + quick add.
7. The Now block.
8. States and copy.
9. Dark mode — mechanical once the tokens are in place, but do it last so you only re-check contrast once.

Steps 1–3 are independently shippable and carry most of the perceived change.

## Assets

No new assets. Icons stay `lucide-react` at 1.75 stroke-width (down from the default 2) for macOS chrome, 2 for active iOS tabs. Add `@fontsource-variable/instrument-sans` and drop `@fontsource-variable/plus-jakarta-sans`.

## Screenshots

In `screenshots/`. Light theme unless noted.

| File | Screen |
|---|---|
| `01-macos-today.png` | macOS three-pane shell — sidebar, Today with the Now block, inspector |
| `02-ios-today.png` | iOS Today |
| `03-ios-capture.png` | iOS capture sheet, keyboard up |
| `04-ios-browse.png` | iOS Browse tab |
| `05-ios-upcoming.png` | iOS Upcoming, incl. the collapsed empty-day run |
| `06-macos-command-palette.png` | ⌘K palette |
| `07-macos-quick-add.png` | ⌘⇧A quick add |
| `08-state-first-run.png` | First run / connect server |
| `09-state-nothing-due.png` | Nothing due today |
| `10-state-sync.png` | All five sync states |
| `11-state-conflict.png` | Conflict resolution |
| `12-macos-today-dark.png` | macOS shell — **dark** |
| `13-ios-today-dark.png` | iOS Today — **dark** |

## Files in this bundle

- `Cria - Redesign.dc.html` — the design. Section **3a** (top) is dark mode. Section **2a** is Ledger resolved across capture, Browse, Upcoming, ⌘K, quick add and states. Section **1a** is the Ledger macOS shell, Today screen, inspector and priority spec. Sections 1b/1c are the two directions that were **not** chosen — ignore them.
- `Cria - Current UI.dc.html` — the app as it ships today, rebuilt from source. Useful as a before/after reference.

Open either file in a browser.
