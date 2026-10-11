import Foundation

/// What the sync banner shows. Ported from `src/stores/syncProgress`.
public struct SyncStatus: Equatable, Sendable {
    public struct StepError: Equatable, Sendable {
        public let step: String
        public let message: String
    }

    /// The step in progress, or nil when idle.
    public var step: String?
    /// Errors from the latest cycle.
    public var errors: [StepError] = []
    public var lastSyncAt: Date?

    public init() {}

    public var isSyncing: Bool { step != nil }
}

/// Observable sync status: new subscribers get the current value first, then every change.
public final class SyncStatusHub: @unchecked Sendable {
    private let lock = NSLock()
    private var value = SyncStatus()
    private var subscribers: [UUID: AsyncStream<SyncStatus>.Continuation] = [:]

    public init() {}

    public var current: SyncStatus { lock.withLock { value } }

    public func subscribe() -> AsyncStream<SyncStatus> {
        let (stream, continuation) = AsyncStream.makeStream(of: SyncStatus.self, bufferingPolicy: .bufferingNewest(1))
        let id = UUID()
        lock.withLock {
            subscribers[id] = continuation
            continuation.yield(value)
        }
        continuation.onTermination = { [weak self] _ in
            self?.lock.withLock { self?.subscribers[id] = nil }
        }
        return stream
    }

    func update(_ change: (inout SyncStatus) -> Void) {
        let (next, listeners) = lock.withLock { () -> (SyncStatus, [AsyncStream<SyncStatus>.Continuation]) in
            change(&value)
            return (value, Array(subscribers.values))
        }
        for listener in listeners { listener.yield(next) }
    }
}

/// Ties the pull, push and reconcile pieces together: the periodic tick, the manual "force sync", and the outbox
/// trigger. Ported from `usePeriodicSync.ts` and `forceSync.ts`.
public actor SyncCoordinator {
    private let puller: Puller
    private let drainer: OutboxDrainer
    private let store: CriaStore
    public nonisolated let status = SyncStatusHub()
    private var periodic: PeriodicSync?
    private var outboxObserver: Task<Void, Never>?
    private var isTicking = false

    public init(puller: Puller, drainer: OutboxDrainer, store: CriaStore) {
        self.puller = puller
        self.drainer = drainer
        self.store = store
    }

    // MARK: Lifecycle

    /// Starts the outbox trigger, a drain for rows left over from a prior session, and the periodic sync.
    public func start(interval: TimeInterval = PeriodicSync.defaultInterval,
                      reconcileInterval: TimeInterval = PeriodicSync.defaultReconcileInterval) async {
        await stop()
        let sync = PeriodicSync(
            interval: interval, reconcileInterval: reconcileInterval,
            tick: { [weak self] in await self?.tick() },
            reconcile: { [weak self] in await self?.reconcile() }
        )
        periodic = sync
        let drainer = drainer
        let events = store.bus.subscribe()
        outboxObserver = Task {
            for await kind in events where kind == .outbox {
                await drainer.drain()
            }
        }
        await sync.start()
    }

    public func stop() async {
        outboxObserver?.cancel()
        outboxObserver = nil
        await periodic?.stop()
        periodic = nil
    }

    /// Scene phase hook: pause while inactive, pull straight away on return.
    public func setActive(_ isActive: Bool) async {
        await periodic?.setActive(isActive)
    }

    // MARK: Cycles

    /// One periodic cycle: drain the outbox (so the circuit breaker is clean and a failed push gets a retry), then
    /// pull projects, saved filters, labels, every task (delta-filtered), views and buckets. A step failing never
    /// stops the next. Overlapping ticks collapse into one.
    public func tick() async {
        guard !isTicking else { return }
        isTicking = true
        defer { isTicking = false }
        await runCycle(track: false)
    }

    /// Manual refresh with per-step progress and collected errors.
    public func forceSync() async {
        guard !isTicking else { return }
        isTicking = true
        defer { isTicking = false }
        await runCycle(track: true)
    }

    public func reconcile() async {
        do {
            try await puller.reconcileDeletions()
        } catch {
            status.update { $0.errors.append(.init(step: "Reconcile", message: String(describing: error))) }
        }
    }

    private func runCycle(track: Bool) async {
        status.update { $0.errors = [] }
        func step(_ name: String, _ work: () async throws -> Void) async {
            if track { status.update { $0.step = name } }
            do {
                try await work()
            } catch {
                status.update { $0.errors.append(.init(step: name, message: String(describing: error))) }
            }
        }
        await step("Pushing local changes…") { await drainer.drain() }
        await step("Fetching projects…") {
            try await puller.pullProjects()
            store.bus.notify(.projects)
        }
        await step("Fetching saved filters…") {
            // Saved-filter details for the pseudo-projects pulled just above.
            try await puller.pullSavedFilters()
            store.bus.notify(.savedFilters)
        }
        await step("Fetching labels…") {
            try await puller.pullLabels()
            store.bus.notify(.labels)
        }
        await step("Fetching tasks…") {
            // Every task, not just the open project, so smart views have cross-project data.
            try await puller.pullAllTasks()
            store.bus.notify(.tasks)
        }
        await step("Fetching views…") {
            try await puller.pullAllViews()
            try await puller.pullAllBuckets()
            store.bus.notify(.views)
        }
        status.update {
            $0.step = nil
            $0.lastSyncAt = Date()
        }
    }
}
