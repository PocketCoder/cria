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

## Decisions to make first

1. **Target shape.** Recommended: a native macOS target in the existing
   XcodeGen project, sharing CriaKit and the platform-neutral views. Not Mac
   Catalyst: it reads as an iPad app and makes the menu bar extra, glass
   sidebar and window handling harder.
2. **Bundle ID and data.** Either take over `io.cria.app` (one install,
   existing updater users move across) or ship as a new ID beside the Tauri
   app. Either way, re-sync from the server on sign-in as iOS does. A
   sandboxed app can't read the Tauri database, so no import: drain the
   Tauri outbox before switching.
3. **Minimum macOS.** 14, to match CriaKit, with availability checks for
   Foundation Models and the macOS 26 glass.
4. **Distribution.** There's no paid Apple account, so there's no
   notarisation and no Mac App Store. Keep the self-signed certificate and
   use Sparkle 2 for updates (EdDSA-signed appcast on `gh-pages`). The first
   launch still shows the "unidentified developer" warning, as today.

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
