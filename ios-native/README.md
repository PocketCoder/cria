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
