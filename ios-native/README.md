# Cria native iOS (Swift)

- `CriaKit/`: Swift package with all logic (data, API, sync). Unit tests with `swift test`.
- `CriaApp/`: SwiftUI app target. Generated with XcodeGen from `project.yml`:
  `brew install xcodegen && cd CriaApp && xcodegen generate`.

Fixed decisions (S-00): iOS 17 minimum, bundle ID `io.cria.app.swift`,
SQLite database in the App Group container `group.io.cria.app`.

## Tooling decisions (S-02)

- **Database:** GRDB 7 (`groue/GRDB.swift`, `from: 7.0.0`), linked into `CriaKit`.
- **API client:** hand-written on `URLSession` (S-20), not `swift-openapi-generator`. The app uses a small endpoint set, and this avoids a codegen step in CI.
- **Lint:** SwiftLint with `ios-native/.swiftlint.yml`. CI runs `swiftlint lint --strict`.

## Data layer (S-10)

- `CriaKit/Sources/CriaKit/Resources/Migrations/`: copies of `src/db/migrations/*.sql`, bundled as resources. Keep them byte-identical to the Tauri copies; never edit a shipped file.
- `CriaMigrations.migrate(_:)` runs them through GRDB's `DatabaseMigrator`, keyed on the file stem (`001_initial`, ...).

## Design system (iOS 26 refresh)

- Tokens: `CriaKit/Sources/CriaKit/Design/ThemeTokens.swift` (OKLCH values ported from the web build, plus `grouped`, `cell` and the accent colours). `swift test` pins them.
- App styling: `CriaApp/Design/Theme.swift` (type scale, `Color(ThemeToken)`) and `Components.swift` (`PriorityCheck`, `CriaFab`, `CriaChip`, `.criaSurface()`, `.criaProminent()`). Use system components for bars, sheets, menus and swipe actions; do not hand-draw glass.
- Font: `Fonts/Onest-Bold.ttf` (OFL) is bundled and listed under `UIAppFonts` in `project.yml`. It is used only for navigation large titles and the login wordmark.
- Preferences: server-backed settings go through `SettingsModel` and `GeneralSettings` (single-field `SettingsChange`, never a full settings object). Local-only preferences live in `LocalPreferences` and reach views through `PreferencesModel` and the `\.dateDisplay` / `\.playsCompletionSound` environment values.
- Summary notifications (morning summary, weekly round-up) are scheduled by `Platform/SummaryScheduler.swift` from the pure plan in `CriaKit/Settings/Summaries.swift`.
- Not verified on a device yet: notification permission and delivery, completion sound, camera shutter, avatar upload, two-factor QR, session revoke, Liquid Glass tab bar.
