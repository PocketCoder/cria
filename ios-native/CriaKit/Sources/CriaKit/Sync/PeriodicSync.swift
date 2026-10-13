import Foundation

/// Runs `tick` every `interval` while the app is active and `reconcile` every `reconcileInterval`. Ported from
/// `usePeriodicSync.ts`. Background timers pause on iOS so they do not drain the battery: `setActive(false)`
/// stops both loops, and `setActive(true)` pulls straight away, so the user sees fresh data on return rather than
/// after up to a minute.
public actor PeriodicSync {
    public static let defaultInterval: TimeInterval = 60
    public static let defaultReconcileInterval: TimeInterval = 15 * 60

    private let interval: TimeInterval
    private let reconcileInterval: TimeInterval
    private let tick: @Sendable () async -> Void
    private let reconcile: @Sendable () async -> Void
    /// When the last reconcile finished. Without it every activation restarts the wait, and on iOS (where the timers
    /// pause in the background) a reconcile would almost never get to run.
    private let lastReconcile: (@Sendable () -> Date?)?
    private var tickTask: Task<Void, Never>?
    private var reconcileTask: Task<Void, Never>?
    private var started = false
    private var active = true

    public init(interval: TimeInterval = PeriodicSync.defaultInterval,
                reconcileInterval: TimeInterval = PeriodicSync.defaultReconcileInterval,
                tick: @escaping @Sendable () async -> Void,
                reconcile: @escaping @Sendable () async -> Void = {},
                lastReconcile: (@Sendable () -> Date?)? = nil) {
        self.lastReconcile = lastReconcile
        self.interval = interval
        self.reconcileInterval = reconcileInterval
        self.tick = tick
        self.reconcile = reconcile
    }

    public var isRunning: Bool { tickTask != nil }

    /// Begins syncing: one tick at once (the smart views need cross-project data straight after launch), then one
    /// per interval. Does nothing while the app is inactive; `setActive(true)` starts it.
    public func start() {
        started = true
        if active { launch() }
    }

    public func stop() {
        started = false
        cancel()
    }

    /// Scene phase hook: pass `scenePhase == .active`.
    public func setActive(_ isActive: Bool) {
        guard isActive != active else { return }
        active = isActive
        guard started else { return }
        if isActive { launch() } else { cancel() }
    }

    private func launch() {
        cancel()
        let interval = interval
        let reconcileInterval = reconcileInterval
        let tick = tick
        let reconcile = reconcile
        let firstReconcileDelay = firstReconcileDelay()
        tickTask = Task {
            await tick()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                if Task.isCancelled { break }
                await tick()
            }
        }
        reconcileTask = Task {
            var wait = firstReconcileDelay
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                if Task.isCancelled { break }
                await reconcile()
                wait = reconcileInterval
            }
        }
    }

    /// A full interval, unless the last reconcile is known: then only what is left of it, or a short wait when none
    /// has ever run.
    private func firstReconcileDelay() -> TimeInterval {
        guard let lastReconcile else { return reconcileInterval }
        guard let last = lastReconcile() else { return min(30, reconcileInterval) }
        return max(0, reconcileInterval - Date().timeIntervalSince(last))
    }

    private func cancel() {
        tickTask?.cancel()
        reconcileTask?.cancel()
        tickTask = nil
        reconcileTask = nil
    }
}
