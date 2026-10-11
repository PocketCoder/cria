import Foundation

/// Shared circuit breaker so a slow or dead server fails fast instead of hanging every request.
/// Ported from `src/api/resilience.ts`: opens after 4 consecutive health failures for 30 seconds.
public final class CircuitBreaker: @unchecked Sendable {
    public static let requestTimeout: TimeInterval = 20
    static let failureThreshold = 4
    static let cooldown: TimeInterval = 30

    private let lock = NSLock()
    private let now: @Sendable () -> Date
    private var consecutiveFailures = 0
    private var openUntil = Date.distantPast

    public init(now: @escaping @Sendable () -> Date = { Date() }) {
        self.now = now
    }

    public func canAttempt() -> Bool {
        lock.withLock { now() >= openUntil }
    }

    public func cooldownRemaining() -> TimeInterval {
        lock.withLock { max(0, openUntil.timeIntervalSince(now())) }
    }

    public func recordSuccess() {
        lock.withLock {
            consecutiveFailures = 0
            openUntil = .distantPast
        }
    }

    /// Timeout, network error or 5xx.
    public func recordFailure() {
        lock.withLock {
            consecutiveFailures += 1
            if consecutiveFailures >= Self.failureThreshold {
                openUntil = now().addingTimeInterval(Self.cooldown)
            }
        }
    }
}
