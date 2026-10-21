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
    /// Callers of `forceSync` that arrived while a cycle was running; they resume when it ends.
    private var idleWaiters: [CheckedContinuation<Void, Never>] = []

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
        // A reconcile (full task refresh, deletions, stuck-row repair) shortly after every launch, not only when the
        // interval since the last one has run out: it is what heals a device that drifted.
        UserDefaults.standard.removeObject(forKey: Self.lastReconcileKey)
        let sync = PeriodicSync(
            interval: interval, reconcileInterval: reconcileInterval,
            tick: { [weak self] in await self?.tick() },
            reconcile: { [weak self] in await self?.reconcile() },
            lastReconcile: { SyncCoordinator.lastReconcile() }
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
        defer { endCycle() }
        let due = Date().timeIntervalSince(Self.lastDeletionCheck() ?? .distantPast) >= Self.deletionCheckInterval
        await runCycle(track: false, checkDeletions: due)
    }

    /// Manual refresh with per-step progress and collected errors: a full sync. When a cycle is already running, this
    /// waits for it to finish first, so a caller that announces "done" afterwards is not early.
    public func forceSync() async {
        // Pull to refresh, Sync Now and ⌘R align this device with the server in full: the same as Full Sync.
        await fullSync()
    }

    private func endCycle() {
        isTicking = false
        let waiting = idleWaiters
        idleWaiters = []
        for waiter in waiting { waiter.resume() }
    }

    /// Deletes local rows the server no longer has. Runs under the same guard as a sync cycle, so a pull and a
    /// reconcile never overlap; if a cycle is running, this one is skipped and the next interval tries again.
    public func reconcile() async {
        guard !isTicking else { return }
        isTicking = true
        defer { endCycle() }
        do {
            try await puller.reconcileDeletions()
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.lastReconcileKey)
        } catch {
            status.update { $0.errors.append(.init(step: "Reconcile", message: String(describing: error))) }
        }
    }

    /// Settings' "Full sync": forgets every watermark, then pulls everything and reconciles. Local edits still
    /// waiting in the outbox are kept and pushed first; only flags with nothing queued behind them are reset.
    public func fullSync() async {
        while isTicking {
            await withCheckedContinuation { idleWaiters.append($0) }
        }
        isTicking = true
        defer { endCycle() }
        status.update { $0.errors = [] }
        do {
            try store.resetSyncStamps()
            try store.healOrphanedSyncFlags()
        } catch {
            status.update { $0.errors.append(.init(step: "Full sync", message: String(describing: error))) }
        }
        await runCycle(track: true, fullReconcile: true)
    }

    /// Up to `fullListLimit` tasks, every cycle reads the whole task list, so the device matches the server each time:
    /// new and changed tasks, relations and label links, and deletions (which a delta pull cannot see). Larger
    /// accounts take the delta each cycle and the full list every few minutes.
    private func pullTasks(full: Bool) async throws {
        if full {
            try await puller.reconcileTaskDeletions()
        } else {
            try await puller.pullAllTasks()
            store.bus.notify(.tasks)
        }
    }

    static let lastReconcileKey = "cria.lastReconcileAt"
    /// Task counts up to this are matched in full every cycle (one request per 50 tasks).
    static let fullListLimit = 2_500
    static let lastDeletionCheckKey = "cria.lastDeletionCheckAt"
    /// How often the periodic tick also checks for tasks deleted elsewhere (one full task list).
    static let deletionCheckInterval: TimeInterval = 5 * 60

    static func lastDeletionCheck() -> Date? {
        let stamp = UserDefaults.standard.double(forKey: lastDeletionCheckKey)
        return stamp > 0 ? Date(timeIntervalSince1970: stamp) : nil
    }

    /// When the last successful reconcile finished, so a launch does not restart the wait from zero.
    static func lastReconcile() -> Date? {
        let stamp = UserDefaults.standard.double(forKey: lastReconcileKey)
        return stamp > 0 ? Date(timeIntervalSince1970: stamp) : nil
    }

    private func runCycle(track: Bool, fullReconcile: Bool = false, checkDeletions: Bool = false) async {
        if !fullReconcile { status.update { $0.errors = [] } }
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
        let full = ((try? store.liveTaskCount()) ?? 0) <= Self.fullListLimit
        await step("Fetching tasks…") { try await pullTasks(full: full) }
        await step("Fetching views…") {
            try await puller.pullAllViews()
            try await puller.pullAllBuckets()
            store.bus.notify(.views)
        }
        if checkDeletions, !fullReconcile, !full {
            await step("Checking for deleted tasks…") {
                try await puller.reconcileTaskDeletions()
                UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.lastDeletionCheckKey)
            }
        }
        if fullReconcile {
            await step("Checking everything against the server…") {
                try await puller.reconcileDeletions()
                UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.lastReconcileKey)
            }
        }
        status.update {
            $0.step = nil
            $0.lastSyncAt = Date()
        }
    }
}
