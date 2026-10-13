import Foundation

// The iOS background-run API has no Mac counterpart: the shared Ramble screen runs its work directly and posts no
// "ready" notice.

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
