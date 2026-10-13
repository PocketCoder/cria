import Foundation

/// Runs one queued op against the server. One executor per entity type (S-34 and S-35).
public protocol OutboxExecutor: Sendable {
    func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws
}

/// Drains the outbox FIFO with exponential backoff. Ported from `drainOutbox` in `src/sync/push.ts`.
///
/// An actor replaces the `__cria_isDraining__` global: bus triggers, the periodic tick and the manual
/// button can all fire at once, and a second drain while one is running must be a no-op.
public actor OutboxDrainer {
    public static let maxAttempts = 10
    public static let maxOpsPerDrain = 100
    static let maxBackoff: TimeInterval = 60
    /// A dependency block that lasts this long means the parent is never coming (it was deleted, or its create was
    /// lost); dead-letter the op so it stops holding up everything behind it.
    static let maxDependencyWait: TimeInterval = 24 * 3600

    private let api: ApiClient
    private let store: CriaStore
    private var executors: [String: any OutboxExecutor]
    private let now: @Sendable () -> Date
    /// The drain in progress, if any. A second caller joins it instead of returning early, so a pull that follows
    /// `drain()` never overlaps a push that is still mid-request.
    private var inFlight: Task<Void, Never>?

    public init(api: ApiClient, store: CriaStore, executors: [String: any OutboxExecutor] = [:],
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.api = api
        self.store = store
        self.executors = executors
        self.now = now
    }

    public func register(_ entityType: String, _ executor: any OutboxExecutor) {
        executors[entityType] = executor
    }

    /// Backoff after the nth failed attempt: `min(60, 2^n)` seconds.
    public static func backoff(attempts: Int) -> TimeInterval {
        min(maxBackoff, pow(2, Double(min(attempts, 30))))
    }

    /// Takes the oldest op, executes it, deletes it on success, backs off or dead-letters on failure,
    /// and stops at the first failure so FIFO order holds across retries.
    public func drain() async {
        if let inFlight {
            await inFlight.value
            return
        }
        let task = Task { await self.runDrain() }
        inFlight = task
        await task.value
    }

    private func runDrain() async {
        defer { inFlight = nil }
        var processed = 0
        while processed < Self.maxOpsPerDrain {
            guard let head = try? store.outboxHead() else { break }
            let stamp = now().formatted(.iso8601)
            // A backing-off head blocks the queue: skipping it would break FIFO.
            if let next = head.nextAttemptAt, next > stamp { break }
            do {
                try await execute(head)
                try store.completeOutboxRow(id: head.id)
                processed += 1
            } catch {
                handleFailure(head, error: error)
                break
            }
        }
    }

    private func execute(_ op: OutboxRow) async throws {
        guard let executor = executors[op.entityType] else {
            throw OutboxError.noExecutor(op.entityType)
        }
        try await executor.execute(op, api: api, store: store)
    }

    private func handleFailure(_ op: OutboxRow, error: any Error) {
        let isDependency = (error as? ApiError)?.dependency ?? false
        // A dependency block (an un-synced parent), being signed out, a rejected token or being offline is not the
        // op's fault, so it does not use up an attempt. Counting offline failures would dead-letter an edit after
        // ~10 minutes without a connection.
        let notTheOpsFault = isDependency || Self.isAuthFailure(error) || isOfflineError(error)
        let attempts = notTheOpsFault ? op.attempts : op.attempts + 1
        let text = String(describing: error)
        let current = now()
        // A conflict waits for the user, however long that takes.
        let isConflict = (error as? ApiError)?.isConflictBlock ?? false
        let staleDependency = isDependency && !isConflict
            && op.createdAt < current.addingTimeInterval(-Self.maxDependencyWait).formatted(.iso8601)
        if !Self.isRetryable(error) || staleDependency || (attempts >= Self.maxAttempts && !isDependency) {
            try? store.deadLetterOutboxRow(op, attempts: attempts, error: text, at: current.formatted(.iso8601))
        } else {
            let next = current.addingTimeInterval(Self.backoff(attempts: attempts)).formatted(.iso8601)
            try? store.recordOutboxFailure(id: op.id, attempts: attempts, error: text, nextAttemptAt: next)
        }
    }

    /// Signed out, or a 401 the client could not refresh past. The TS drain dead-letters a 401 like any 4xx, which
    /// loses the queue when a token is revoked; here the op waits, `AuthSession` signs out after three 401s in a row,
    /// and signing back in resumes the queue.
    static func isAuthFailure(_ error: any Error) -> Bool {
        error is AuthRequiredError || (error as? ApiError)?.status == 401
    }

    static func isRetryable(_ error: any Error) -> Bool {
        switch error {
        // Signed out, a rejected token or offline mid-drain is not the op's fault; keep it queued.
        case _ where isAuthFailure(error): true
        case let api as ApiError: api.retryable
        case is NetworkError: true
        case is URLError: true
        default: false
        }
    }
}

public enum OutboxError: Error, Equatable, CustomStringConvertible {
    case noExecutor(String)

    public var description: String {
        switch self {
        case .noExecutor(let type): "No executor for outbox entity type '\(type)'"
        }
    }
}
