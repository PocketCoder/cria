import XCTest
@testable import CriaKit

final class CircuitBreakerTests: XCTestCase {
    private final class Clock: @unchecked Sendable {
        var date = Date(timeIntervalSince1970: 1_000)
    }

    func testOpensAfterFourFailuresAndClosesAfterCooldown() {
        let clock = Clock()
        let breaker = CircuitBreaker(now: { clock.date })
        for _ in 0..<3 { breaker.recordFailure() }
        XCTAssertTrue(breaker.canAttempt())
        breaker.recordFailure()
        XCTAssertFalse(breaker.canAttempt())
        XCTAssertEqual(breaker.cooldownRemaining(), 30, accuracy: 0.001)
        clock.date.addTimeInterval(31)
        XCTAssertTrue(breaker.canAttempt())
        XCTAssertEqual(breaker.cooldownRemaining(), 0)
    }

    func testSuccessResetsStreak() {
        let breaker = CircuitBreaker()
        for _ in 0..<3 { breaker.recordFailure() }
        breaker.recordSuccess()
        for _ in 0..<3 { breaker.recordFailure() }
        XCTAssertTrue(breaker.canAttempt())
    }
}
