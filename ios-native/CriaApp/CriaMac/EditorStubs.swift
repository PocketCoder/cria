import CriaKit
import SwiftUI

// Stand-ins for the iOS-only AI entry points, so the shared quick add and ramble screens compile on macOS. Phase 6
// replaces them.

struct ShoppingPhotoSheet: View {
    let services: AppServices

    var body: some View {
        ContentUnavailableView("Photo tidy is not on the Mac yet", systemImage: "camera")
    }
}

enum BackgroundRun {
    /// No background extension on the Mac: the work simply runs.
    static func run<T: Sendable>(title: String, work: @escaping @Sendable () async throws -> T) async throws -> T {
        try await work()
    }
}

enum RambleNotice {
    static func postIfBackgrounded(count: Int) async {}

    static func clear() {}
}
