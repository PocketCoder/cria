# Native macOS app: plan

Outline for a SwiftUI macOS app that replaces the Tauri desktop app, the way
`ios-native/` replaced the Tauri iOS build. Not started. Sizes are relative
(S under a day, M a few days, L a week or more), not commitments.

## Starting point

- **CriaKit is ready.** It already declares `.macOS(.v14)`, imports no UIKit,
  and its tests run on macOS in `ci-swift.yml`. Data, API, sync, outbox,
  conflicts, parsers, reminders and AI prompts all carry over unchanged.
- **CriaApp is iPhone-shaped.** 141 files; 40 touch UIKit (Tasks 11,
  Editor 9, Settings 6, then a few in Views, Projects, Shell, AI). The tab
  bar, sheets and swipe actions don't suit a Mac window.
- **The editor is the big port.** `Editor/` is built on `UITextView`; macOS
  needs an `NSTextView` version of the same controller (formatting, mentions,
  inline images, paste).
- **What the Tauri desktop app does that the iOS app doesn't:** tray, global
  quick-add shortcut, launch at login, auto-update, single instance, deep
  links, glass sidebar, three-pane shell with inspector, command palette and
  keyboard shortcuts, wide Kanban/table/Gantt.

## Decisions (agreed 2026-10-13)

1. **Target shape: native macOS target** in the existing XcodeGen project,
   sharing CriaKit and the platform-neutral views. Not Mac Catalyst.
2. **Bundle ID: take over `io.cria.app`.** The native app ships as the next
   update to the Tauri app, so installed copies move across. It re-syncs from
   the server on first launch (the Tauri database isn't imported, and a
   sandboxed app can't read it), so the last Tauri release must drain its
   outbox and warn about unsynced changes before handing over. The keychain
   item and URL scheme stay the same.
3. **Minimum macOS 14**, matching CriaKit, with availability checks for
   Foundation Models and the macOS 26 glass.
4. **Distribution: still open.** No paid Apple account means no notarisation
   and no Mac App Store. In-app updates need Sparkle (the standard framework
   for this, and what Tauri's updater copies); a Homebrew tap can sit beside it
   for installs but doesn't update the app by itself.

## Phases

| # | Phase | Size | Exit |
|---|---|---|---|
| 0 | **Spike.** macOS target in `project.yml`; sign-in, sync loop and a sidebar → list → detail `NavigationSplitView` reading the shared DB. CI builds it. | M | Tasks sync and edit round-trip on a Mac |
| 1 | **Platform seams.** Move UIKit uses (pasteboard, images, open URL, share, haptics) behind small `Platform/` wrappers; split iPhone-only views from shared ones. iOS behaviour unchanged. | M | Both targets compile from one source tree |
| 2 | **Shell.** Three-pane window with inspector, toolbar, menu `Commands`, keyboard shortcuts matching the desktop app, Cmd+K palette, glass sidebar. | L | Daily-driver navigation without a mouse |
| 3 | **Editor.** `NSTextView` port of `Editor/`: formatting, @mentions, pasted and dropped images through the attachment outbox. | L | Descriptions and comments match iOS |
| 4 | **Views.** List, Kanban (drag between columns), SwiftUI `Table`, Gantt, search, saved filters, sharing, settings window. | L | Parity with Tauri desktop views |
| 5 | **Mac integrations.** `MenuBarExtra` (tray), global quick-add hotkey, `SMAppService` launch at login, `cria://` URL scheme, notifications with Complete/Snooze, file drop for attachments, widgets. | M | Every desktop-only Tauri feature covered |
| 6 | **AI, OCR, speech.** Call Foundation Models, Vision and Speech directly from Swift; the Rust bridge and `swift-rs` go away. | S | Ramble, photo tidy and summaries work |
| 7 | **Release.** Sparkle, DMG, signing in `release.yml` and `nightly.yml`, nightly flavour with its own bundle ID. | M | A tagged release updates an installed copy |
| 8 | **Parity audit, then deprecate Tauri desktop.** Same process as iOS: audit, close gaps, mark the Tauri app deprecated, keep its code. | M | Tauri desktop no longer built or released |

## Risks

- SwiftUI on macOS still has rough edges (`Table` editing, focus, text
  input). Budget for AppKit fallbacks.
- Two SwiftUI apps double the UI surface. Keep logic in CriaKit and shared
  views; avoid copying iOS views into a macOS folder.
- Linux can't build either app; macOS CI stays the only gate, so keep
  CriaKit test coverage high.
