import Foundation

/// Coalesces concurrent calls with the same key into one run. Ported from `singleFlight` in `src/db/index.ts`.
/// The key is released when the run finishes, so a later call starts a fresh one.
public actor SingleFlight {
    private var running: [String: Task<Int, any Error>] = [:]

    public init() {}

    public func run(_ key: String, _ work: @escaping @Sendable () async throws -> Int) async throws -> Int {
        if let existing = running[key] {
            return try await existing.value
        }
        let task = Task { try await work() }
        running[key] = task
        defer { running[key] = nil }
        return try await task.value
    }
}
