# Cria native iOS (Swift)

- `CriaKit/`: Swift package with all logic (data, API, sync). Unit tests with `swift test`.
- `CriaApp/`: SwiftUI app target. Generated with XcodeGen from `project.yml`:
  `brew install xcodegen && cd CriaApp && xcodegen generate`.

Fixed decisions (S-00): iOS 17 minimum, bundle ID `io.cria.app.swift`,
SQLite database in the App Group container `group.io.cria.app`.
