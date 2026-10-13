# Native macOS app: plan

A SwiftUI macOS app that replaces the Tauri desktop app, the way `ios-native/`
replaced the Tauri iOS build. Written to be executed one phase at a time by an
agent: each phase lists exact files, steps and a check that proves it is done.

## Status

| Phase | Title | Status |
|---|---|---|
| 0 | Scaffold the macOS target | Done |
| 1 | Share the platform-neutral code | Done |
| 2 | Window shell, menus and shortcuts | Partly done (compiles in CI, untested on a Mac; `j`/`k`/Return, `a`, `c`, `u`, `.` identifier and `g a`/`g m` not built) |
| 3 | Rich text editor on macOS | Partly done (compiles in CI, untested on a Mac; mention picker is a sheet, not a caret popover; link is ⌘L because ⌘K is the palette) |
| 4 | Project views and settings | Partly done (compiles in CI, untested on a Mac; table uses the shared grid, not SwiftUI `Table`; no drag-and-drop or hover work beyond rows) |
| 5 | Mac integrations | Partly done (compiles in CI, none of it tried on a Mac; global hotkey opens quick add in the main window, not a floating panel; no Dock badge) |
| 6 | AI, OCR and speech | Partly done (compiles in CI, untried on a Mac; photo uses file picker, Photos and paste; Ramble runs directly with no background task) |
| 7 | Sparkle updates and release | Not started |
| 8 | Handover from Tauri, parity audit, deprecation | Not started |

Update this table in the same PR that finishes a phase.

## Decisions (agreed 2026-10-13)

1. **Native macOS target** in the existing XcodeGen project
   (`ios-native/CriaApp/project.yml`), sharing CriaKit and the
   platform-neutral SwiftUI views. Not Mac Catalyst.
2. **Bundle ID `io.cria.app`**, taking over from the Tauri app. Nightly is
   `io.cria.app.nightly`, local Debug builds `io.cria.app.dev` (the same IDs
   as the Tauri flavours).
3. **Minimum macOS 15** (raised from 14 on 2026-10-13: one release back from
   the current macOS 26; the CriaKit package itself still builds for 14).
   Foundation Models (macOS 26) and anything newer go behind `if #available`.
4. **Updates through Sparkle 2**, signed with an EdDSA key, appcast on
   `gh-pages`. No notarisation (no paid Apple account); builds are signed with
   the existing self-signed certificate (`APPLE_SIGNING_IDENTITY` secret).
5. **Not sandboxed.** Sparkle, the global hotkey and reading the Tauri
   keychain item are all simpler outside the sandbox, and apps outside the
   Mac App Store don't need it.
6. **No app group on macOS.** App groups need a provisioning profile that a
   self-signed build can't get, so the database lives in Application Support.
   Widgets and the share extension are out of scope for now.
7. **Data on handover: re-sync, not import.** The native app signs in with
   the credential the Tauri app left in the keychain, then pulls everything
   from the server. The Tauri app must have an empty outbox before it installs
   the native app (Phase 8 adds that gate).

## Ground rules for every phase

Read `AGENTS.md` first; everything there applies. In particular:

- **Branching.** Branch off `dev` as `feature/macos-phase-<N>`. One PR per
  phase into `dev`. Never commit to `main`.
- **Never edit a migration** (`src/db/migrations/` or the copies in
  `ios-native/CriaKit`). Never change sync rules (silent upserts, outbox FIFO,
  settings merge-patch).
- **iOS must not change.** Every edit to a shared file keeps iOS behaviour
  identical. Use `#if os(macOS)` / `#if os(iOS)` (or `#if canImport(UIKit)`)
  around platform code. CI's iOS simulator build is the guard.
- **SwiftLint `--strict`** limits: type body 250 lines, file 400 lines,
  function body 50 lines, line 140 characters, identifiers at least 3
  characters. Split files rather than disabling rules.
- **Stay in scope.** Do only the current phase. If you find a bug elsewhere,
  note it in the PR description; don't fix it.
- **UI text** matches the iOS app's wording where the feature exists there.

### How to build and check

Where you have a Mac with Xcode 26:

```sh
cd ios-native/CriaApp && xcodegen generate
xcodebuild build -project CriaApp.xcodeproj -scheme CriaMac \
  -destination 'generic/platform=macOS' CODE_SIGNING_ALLOWED=NO
xcodebuild build -project CriaApp.xcodeproj -scheme CriaApp \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
cd ../CriaKit && swift test
cd .. && swiftlint lint --strict
```

On Linux (a cloud session) the apps can't be compiled. Run
`swiftc -parse <files you changed>` for syntax and `swiftlint lint --strict`
if it's installed, then push the branch, open the PR and read the
`CI (native Swift iOS)` check, which builds both apps on macOS. If the same CI
error survives two fix attempts, stop and report the log in the PR.

### When to stop and ask the user

- A step needs their Mac (manual testing, generating keys) or a GitHub secret.
- A step would change iOS behaviour or any request sent to the server.
- The phase can't be finished without work from a later phase.

## Phase 0: scaffold the macOS target

Goal: a `CriaMac` app that signs in, syncs and shows a task list. CI builds it.

1. **CriaKit data path.** In
   `ios-native/CriaKit/Sources/CriaKit/Platform/CriaPaths.swift`, make
   `dataDirectory` return, on macOS only,
   `~/Library/Application Support/<Bundle.main.bundleIdentifier ?? "io.cria.app.dev">/Native/`
   (create it if missing), before the app group check. iOS keeps its current
   code path. The Tauri app's files live in the parent folder; the `Native`
   subfolder keeps clear of them. Add a CriaKit test, wrapped in
   `#if os(macOS)`, that the path ends in `Native`.
2. **XcodeGen target.** In `ios-native/CriaApp/project.yml`:
   - Under `options.deploymentTarget` add `macOS: "14.0"`.
   - Add a target:
     ```yaml
     CriaMac:
       type: application
       platform: macOS
       sources: [CriaMac]
       dependencies:
         - package: CriaKit
       info:
         path: Config/CriaMac-Info.plist
         properties:
           CFBundleURLTypes:
             - CFBundleURLName: io.cria.app
               CFBundleURLSchemes: [cria]
       settings:
         base:
           PRODUCT_NAME: Cria
           SWIFT_VERSION: "6.0"
           GENERATE_INFOPLIST_FILE: YES
           INFOPLIST_KEY_LSApplicationCategoryType: public.app-category.productivity
           INFOPLIST_KEY_NSMicrophoneUsageDescription: Listen while you speak a list of tasks.
           INFOPLIST_KEY_NSSpeechRecognitionUsageDescription: Turn what you say into text for your tasks.
           ENABLE_HARDENED_RUNTIME: YES
         configs:
           Debug:
             PRODUCT_BUNDLE_IDENTIFIER: io.cria.app.dev
           Release:
             PRODUCT_BUNDLE_IDENTIFIER: io.cria.app
     ```
   - Add `CriaMac/Assets.xcassets` with a macOS `AppIcon` set built from the
     PNGs in `src-tauri/icons/` (reuse them; don't redraw).
3. **App files** in `ios-native/CriaApp/CriaMac/`:
   - `CriaMacApp.swift`: `@main struct CriaMacApp: App` with one
     `WindowGroup` showing `MacRootView`, default size 1100×720.
   - `MacRootView.swift`: with no session, a sign-in form; otherwise a
     `NavigationSplitView` with a sidebar (Inbox, Today, Upcoming, then the
     project list), a task list for the selection (titles and a done
     checkbox), and a detail column showing the selected task's title.
   - Read `CriaApp/CriaApp/AppModel.swift` and `CriaApp/CriaApp/LoginView.swift`
     to see how the iOS app starts services, signs in and runs sync. Reuse
     their CriaKit calls; copy only the minimum into `CriaMac/` (Phase 1 shares
     these files properly).
   - Start and stop sync when the app becomes active or inactive, the way
     `CriaApp/CriaApp/CriaApp.swift` does with `scenePhase`. Skip
     `CriaDatabase.suspend()`: it exists for iOS's shared container.
4. **CI.** In `.github/workflows/ci-swift.yml`, job `test-and-build`, after
   "Build app for simulator", add a "Build macOS app" step running the macOS
   `xcodebuild` command from "How to build and check". Update the comment at
   the top of the file to say it also builds the macOS app. Don't touch the
   `publish-ipa` job.
5. **Docs.** Add a "macOS app" paragraph to `ios-native/README.md`: how to
   build and run it locally, and that it doesn't ship yet.

Done when: CI is green with the new step, and (on a Mac) the app signs in,
syncs and lists tasks.

## Phase 1: share the platform-neutral code

Goal: the macOS target compiles the iOS app's shared views instead of copies.

1. Change the `CriaMac` sources in `project.yml` to:
   ```yaml
   sources:
     - CriaMac
     - path: CriaApp
       excludes: [<the iOS-only files from step 3>]
   ```
2. Add `CriaApp/CriaApp/Platform/PlatformTypes.swift` with:
   - `typealias PlatformImage` (`UIImage` / `NSImage`), `PlatformColor`,
     `PlatformFont`.
   - `enum Pasteboard { static func copy(_ text: String); static func image() -> PlatformImage? }`
     using `UIPasteboard` / `NSPasteboard`.
   - `enum ExternalLink { static func open(_ url: URL) }` using
     `UIApplication.shared.open` / `NSWorkspace.shared.open`.
   Replace direct UIKit calls in shared files with these. Each replacement
   must behave exactly as before on iOS.
3. Files that start as iOS-only (exclude them from `CriaMac`; later phases
   bring them in): everything in `Editor/` (Phase 3),
   `Tasks/CameraPicker.swift`, `AI/BackgroundRun.swift` and
   `AI/ShoppingPhotoSheet.swift` (Phase 6), `Shell/ShellView.swift` and the
   tab bar (Phase 2 replaces them), `CriaApp.swift` (the iOS entry point),
   `Platform/CriaIntents.swift`. For every other file, guard the iOS-only
   lines rather than excluding the file. The other UIKit users today:
   `Design/Theme.swift`, `Design/Haptics.swift` (make it a no-op on macOS),
   `Platform/LinkOpener.swift`, `Projects/LabelEditorSheet.swift`,
   `Projects/ProjectBackgroundView.swift`,
   `Projects/UnsplashBackgroundPicker.swift`,
   `Settings/AccountSettingsView.swift`, `Settings/ApiTokensView.swift`,
   `Settings/AvatarImage.swift`, `Settings/CaldavTokensView.swift`,
   `Settings/NotificationSettingsSection.swift`,
   `Settings/SecuritySettingsView.swift`, `Shell/ConflictSheet.swift`,
   `Shell/OutboxView.swift`, `Tasks/AttachmentsSection.swift`,
   `Tasks/ClipboardPeek.swift`, `Tasks/DescriptionField.swift`,
   `Tasks/EditorImageHit.swift`, `Tasks/ImageViewer.swift`,
   `Tasks/ReminderSection.swift`, `Tasks/RichTextView.swift`,
   `Tasks/TaskColourRow.swift`, `Tasks/TaskDetailPresentation.swift`,
   `Tasks/TaskRowLink.swift`, `Views/ProjectBackgroundBanner.swift`,
   `Views/ProjectHeader.swift`, `Views/ProjectScreen.swift`.
4. iOS-only SwiftUI API that needs `#if os(iOS)`:
   `.textInputAutocapitalization`, `.keyboardType`,
   `.navigationBarTitleDisplayMode`, `.listStyle(.insetGrouped)`,
   `EditButton`, `.environment(\.editMode, …)`, and toolbar placements
   `.topBarLeading` / `.topBarTrailing` (use `.navigation` / `.primaryAction`
   on macOS).
5. Delete the Phase 0 copies that are now shared (sign-in, app model).
6. Where a shared file would need more than about five guards, split it into
   `Foo.swift` (shared) and `Foo+iOS.swift` (excluded from `CriaMac`) rather
   than scattering `#if`s.

Done when: CI builds both apps, iOS behaviour is unchanged, and the macOS app
uses the shared task list, task detail and settings views.

## Phase 2: window shell, menus and shortcuts

Goal: the window feels like a Mac app and every desktop shortcut works.

1. `CriaMac/MacShell.swift`: a three-column `NavigationSplitView`.
   - Sidebar: Inbox, Today, Upcoming, Favourites, Search, then projects as a
     tree (reuse `Shell/NavigationModel.swift` and the data
     `Projects/BrowseView.swift` reads; sub-projects expand with
     `DisclosureGroup`), then saved filters. Counts on the right when the
     "Show task count" setting is on.
   - Content: the existing screens (`SmartViewScreen`, `ProjectScreen`,
     `SearchScreen`).
   - Detail: `TaskDetailView` for the selected task, or "No task selected".
   - On macOS 26 the sidebar gets the system glass automatically; don't give
     it a background.
2. `CriaMac/MacCommands.swift`: `Commands` for the menu bar.
   - File: New Task ⌘N (quick add), New Project ⇧⌘N.
   - View: Toggle Sidebar ⌘E, List / Kanban / Table / Gantt.
   - Go: Today, Upcoming, Inbox, Search ⌘F.
   - Task (enabled when a task is selected): Toggle Done, Due Date, Priority,
     Labels, Move to Project, Favourite, Copy Link ⌘., Delete ⌫.
   - Help: Keyboard Shortcuts.
3. Single-key and two-key shortcuts from `src/lib/shortcuts.ts` (`SHORTCUTS`):
   `g o` Today, `g u` Upcoming, `g l` / `g k` / `g t` / `g g` view switches,
   `j` / `k` next and previous task, Return opens, `t` done, `d` due,
   `p` priority, `l` labels, `m` move, `s` favourite, `.` copy identifier.
   Use `.onKeyPress` on the content column, active only when no text field
   has focus. Two-key sequences time out after one second.
4. `CriaMac/CommandPalette.swift`: ⌘K opens a palette (a sheet with a search
   field and a list) over projects, saved filters, smart views and the
   commands above. Port the behaviour of `src/components/CommandPalette.tsx`.
5. A `Settings { … }` scene so ⌘, opens the shared settings views in a
   settings window (tabs: General, Customise, Account, Notifications, Data).
6. Quick add: present `QuickAdd/QuickAddSheet.swift` as a sheet on the window.

Done when: every shortcut in `src/lib/shortcuts.ts` that applies works, and
there's no iPhone-style tab bar anywhere.

## Phase 3: rich text editor on macOS

Goal: descriptions and comments edit on macOS exactly as on iOS.

1. Read every file in `CriaApp/CriaApp/Editor/`. Split each into shared logic
   (attributed-string styling, paragraph rules, HTML in and out, mentions,
   commands) and the `UITextView` host.
2. Move the shared logic into files that compile on both platforms, using
   `PlatformFont` / `PlatformColor` / `PlatformImage`.
3. Add `CriaMac/Editor/MacEditorTextView.swift`: an `NSViewRepresentable`
   wrapping `NSTextView` in an `NSScrollView`, driven by the same controller
   API as `Editor/EditorTextView.swift`.
4. Formatting: a toolbar above the editor (bold, italic, strikethrough, code,
   heading, bullet list, numbered list, checklist, link) plus ⌘B, ⌘I, ⌘U and
   ⌘K for a link. The HTML output must equal iOS's for the same input; test
   the shared conversion.
5. @mentions: the same picker, as a popover at the caret.
6. Images: pasting or dropping an image queues an attachment upload exactly
   as iOS does (`cria://pending/…` until it uploads; see "Attachment uploads
   ride the outbox" in `AGENTS.md`).

Done when: a description written on the Mac round-trips through Vikunja and
looks the same on iOS and Vikunja-web.

## Phase 4: project views and settings

Goal: parity with the Tauri desktop's views.

1. **Kanban**: bring in `Views/Kanban*.swift`. Columns scroll horizontally;
   cards drag between columns with `.draggable` / `.dropDestination` (the
   same CriaKit calls as iOS). Right-click menu on cards with the same actions
   as the iOS long-press.
2. **Table**: on macOS use SwiftUI `Table` with sortable, resizable columns
   matching `Views/TableViewScreen.swift`'s columns and its cell-editing
   toggle. iOS keeps its own table.
3. **Gantt**: bring in `Views/Gantt*.swift`; scrolls with trackpad and mouse.
4. **List rows**: hover highlight, a right-click menu with the same actions
   as swipe and long-press on iOS, multi-select with ⌘-click and ⇧-click
   (use the existing `Tasks/TaskSelection.swift`).
5. **Sheets** that fill the screen on iPhone get a size on macOS
   (`.frame(minWidth: 480, minHeight: 400)`).
6. **Settings**: every shared settings screen reachable from the Settings
   window; hide iPhone-only rows (haptics, swipe actions, tab bar choices).

Done when: every row marked ✅ for desktop in `FEATURE-COMPARISON.md` works
in the macOS app (list them in the PR).

## Phase 5: Mac integrations

Goal: every desktop-only Tauri feature has a native equivalent.

1. **Menu bar extra** (`MenuBarExtra`): today's tasks with checkboxes, "New
   Task…", "Open Cria", "Quit". Shown when "Show in menu bar" is on (default
   on, like `trayIconEnabled` in `src/stores/settings.ts`).
2. **Close to menu bar** (default on, like `closeToTray`): closing the window
   keeps the app running. **Hide Dock icon** (default off, like
   `hideDockOnTray`): `NSApp.setActivationPolicy(.accessory)` while no window
   is open.
3. **Global quick-add hotkey**: add the SwiftPM package
   `https://github.com/sindresorhus/KeyboardShortcuts` (latest 2.x). A
   recorder in Settings; the hotkey opens quick add in a small floating panel
   from anywhere. Use the Tauri app's default (find it in
   `src/stores/settings.ts` and `src/tauri/globalShortcut.ts`).
4. **Launch at login**: `SMAppService.mainApp.register()` / `unregister()`
   behind a Settings toggle.
5. **Notifications**: reminders and summaries through
   `UNUserNotificationCenter`, reusing `Platform/NotificationRouter.swift`,
   `Platform/ReminderActions.swift` (Complete, Snooze) and
   `Tasks/ReminderScheduler.swift`. Clicking a notification opens the task.
6. **URL scheme**: `cria://` links open the right task or project through
   CriaKit's `DeepLink` and `.onOpenURL`.
7. **File drop**: dropping files on a task's detail queues attachment uploads.

Done when: each item works on a Mac and is listed in the PR with how it was
checked.

## Phase 6: AI, OCR and speech

Goal: the on-device features run natively, with no Rust bridge.

1. `AI/SystemOnDeviceModel.swift` (Foundation Models) compiles for macOS
   behind `if #available(macOS 26, *)`. AI buttons show only where the model
   is available, as on iOS.
2. `AI/BackgroundRun.swift` stays iOS-only; on macOS run the same work
   directly in a `Task`.
3. `AI/SpeechCapture.swift` compiles on macOS (there's no `AVAudioSession`).
   Hardened runtime needs the `com.apple.security.device.audio-input`
   entitlement: add `CriaMac/CriaMac.entitlements` and set
   `CODE_SIGN_ENTITLEMENTS` for `CriaMac`.
4. Shopping photo / OCR: replace the camera with an image file picker and
   paste; reuse the Vision text-recognition code.
5. Ramble, subtask suggestions, filter from text and thread summary are
   reachable from the same places as on iOS.

Done when: Ramble and photo tidy work on a macOS 26 Mac, and the buttons are
hidden on macOS 14 and 15.

## Phase 7: Sparkle updates and release

Goal: tagged releases and nightlies ship the native app with working updates.
The Tauri app keeps shipping alongside until Phase 8.

1. **User action (stop and ask):** on their Mac, download Sparkle 2's latest
   release and run `./bin/generate_keys`, then
   `./bin/generate_keys -x sparkle_private.key`. They add the file's contents
   as the GitHub secret `SPARKLE_PRIVATE_KEY` and give you the public key.
2. Add the SwiftPM package `https://github.com/sparkle-project/Sparkle`
   (from 2.6.0) to `CriaMac`. In `CriaMacApp.swift` create one
   `SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)`
   and add "Check for Updates…" to the app menu.
3. Info.plist properties for `CriaMac`: `SUPublicEDKey` (the public key),
   `SUEnableAutomaticChecks: YES`, and `SUFeedURL`:
   - Release: `https://pocketcoder.github.io/cria/appcast.xml`
   - Nightly: `https://pocketcoder.github.io/cria/nightly-appcast.xml`
   Pass the feed, bundle ID and product name on the `xcodebuild` command line
   in CI (`INFOPLIST_KEY_SUFeedURL=…`, `PRODUCT_BUNDLE_IDENTIFIER=…`,
   `PRODUCT_NAME=…`).
4. **Versions.** `MARKETING_VERSION` is `package.json`'s version.
   `CURRENT_PROJECT_VERSION` is the workflow's `github.run_number`; Sparkle
   compares this number, so it must only grow within each feed.
5. **release.yml**: a new job `build-macos-native` (`needs: verify-version`,
   `runs-on: macos-latest`):
   - Select Xcode, install XcodeGen, run `xcodegen generate`.
   - Copy the "Configure macOS code signing" step from the existing Tauri
     build job unchanged.
   - `xcodebuild archive -project CriaApp.xcodeproj -scheme CriaMac -configuration Release -archivePath "$RUNNER_TEMP/Cria.xcarchive" ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO MARKETING_VERSION=<version> CURRENT_PROJECT_VERSION=${{ github.run_number }} CODE_SIGN_IDENTITY="$APPLE_SIGNING_IDENTITY"`
     (`CODE_SIGN_IDENTITY=-` when the secret is missing).
   - Take `Cria.app` from the archive's `Products/Applications`.
   - `ditto -c -k --keepParent Cria.app Cria-macOS.zip` for Sparkle, and
     `hdiutil create -volname Cria -srcfolder Cria.app -ov -format UDZO Cria-macOS.dmg`
     for first installs.
   - Download the same Sparkle release in CI and sign the zip:
     write `$SPARKLE_PRIVATE_KEY` to a file, then
     `./bin/sign_update Cria-macOS.zip --ed-key-file <file>` (prints the
     `sparkle:edSignature` and `length`). Delete the key file afterwards.
   - Add both files to the GitHub release (the existing publish job collects
     artifacts; add these to it).
   - Write `appcast.xml` with one `<item>`: `sparkle:version` = build number,
     `sparkle:shortVersionString` = version, `sparkle:minimumSystemVersion`
     14.0, and an enclosure with the release zip's URL, signature and length.
     Publish it to `gh-pages` beside `update.json`, the same way the existing
     job publishes `update.json`.
6. **nightly.yml**: the same build with bundle ID `io.cria.app.nightly`,
   product name `Cria (Nightly)` and the nightly feed, uploaded to the rolling
   `nightly` prerelease, with `nightly-appcast.xml` on `gh-pages`.
7. **Docs**: the "Release channels" table in `AGENTS.md` gains the native
   app rows; "Cutting a release" mentions the new job and secret.

Done when: a test tag produces a release with the zip and DMG, the appcast is
on `gh-pages`, and an older native build updates itself through Sparkle (the
user checks this on their Mac).

## Phase 8: handover from Tauri, parity audit, deprecation

Goal: existing Tauri installs become the native app, then Tauri desktop
stops shipping.

1. **Sync gate in the Tauri app**, shipped first as its own normal release:
   before `installUpdate` in `src/tauri/updater.ts` (called from
   `src/stores/updater.ts`), run `drainOutbox` from `src/sync/push.ts` and
   count pending outbox and dead-letter rows. If any remain, don't install;
   show "Sync your changes before updating" with a retry. Unit-test both
   paths, then run `pnpm typecheck`, `pnpm lint` and `pnpm test`.
2. **Credential takeover in the native app**: on first launch with no native
   session, read the Tauri keychain item (service `Cria`, account
   `vikunja-token`; nightly `vikunja-token.nightly`, dev `vikunja-token.dev`;
   see `src-tauri/src/secure.rs`). Its JSON has the same keys as CriaKit's
   `Credentials` (`serverUrl`, `token`, `authMethod`, `refreshToken`), so
   read it with `CredentialStore(slot: KeychainSlot(service: "Cria", account: …))`,
   save it to the native store and start a full sync. If it's missing or
   unreadable, show sign-in. Test it with `MemorySlot`, as
   `CredentialStoreTests.swift` does.
3. **Handover release**: the Tauri updater replaces the installed `.app` with
   the bundle inside the `.app.tar.gz` that `update.json` points to, after
   checking its minisign signature. For this release, `release.yml` makes
   `tar czf Cria-native.app.tar.gz Cria.app` from the native app, signs it
   with `pnpm tauri signer sign` using `TAURI_SIGNING_PRIVATE_KEY`, and points
   both `darwin-aarch64` and `darwin-x86_64` in `update.json` at it.
   **Stop and ask the user to test this on a Mac** running the previous Tauri
   release, with a test manifest, before tagging.
4. **Parity audit**: go through `FEATURE-COMPARISON.md` and `src/features/`
   and list anything the native app lacks. Fix small gaps; list large ones
   for the user.
5. **Deprecate Tauri desktop** once the handover release is out: remove the
   Tauri build jobs from `release.yml` and `nightly.yml`, leave the last
   `update.json` pointing at the native app, and mark the Tauri app deprecated
   in `AGENTS.md` and `README.md` the way the Tauri iOS build was. Keep its
   code.

Done when: a Mac running the last Tauri release updates into the native app,
stays signed in, and shows its data after one sync.
