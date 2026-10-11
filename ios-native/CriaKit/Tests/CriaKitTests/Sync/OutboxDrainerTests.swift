import GRDB
import XCTest
@testable import CriaKit

private final class Clock: @unchecked Sendable {
    private let lock = NSLock()
    private var date = Date(timeIntervalSince1970: 1_800_000_000)
    var now: Date { lock.withLock { date } }
    func advance(_ seconds: TimeInterval) { lock.withLock { date = date.addingTimeInterval(seconds) } }
}

private final class ScriptedExecutor: OutboxExecutor, @unchecked Sendable {
    private let lock = NSLock()
    private var seen: [Int] = []
    private var failures: [Int: any Error]
    private let delay: UInt64

    init(failures: [Int: any Error] = [:], delay: UInt64 = 0) {
        self.failures = failures
        self.delay = delay
    }

    var executed: [Int] { lock.withLock { seen } }

    func fail(_ id: Int, with error: (any Error)?) {
        lock.withLock { failures[id] = error }
    }

    func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws {
        lock.withLock { seen.append(op.id) }
        if delay > 0 { try await Task.sleep(nanoseconds: delay) }
        if let error = lock.withLock({ failures[op.id] }) { throw error }
    }
}

final class OutboxDrainerTests: XCTestCase {
    private func enqueue(_ store: CriaStore, _ count: Int) throws {
        try store.database.writer.write { connection in
            for index in 0..<count {
                try connection.enqueue(.task, localId: "t\(index)", operation: .create, payload: ["n": index], at: isoNow())
            }
        }
    }

    private func makeDrainer(_ store: CriaStore, _ executor: ScriptedExecutor, clock: Clock = Clock()) -> OutboxDrainer {
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: StubServer().transport))
        return OutboxDrainer(api: api, store: store, executors: ["task": executor], now: { clock.now })
    }

    func testDrainsInFIFOOrderAndAnnounces() async throws {
        let store = try makeStore()
        try enqueue(store, 3)
        let executor = ScriptedExecutor()
        var iterator = store.bus.subscribe().makeAsyncIterator()
        await makeDrainer(store, executor).drain()
        XCTAssertEqual(executor.executed, [1, 2, 3])
        XCTAssertEqual(try store.outboxRows().count, 0)
        let first = await iterator.next()
        XCTAssertEqual(first, .outbox)
    }

    func testBackoffGrowsAndBlocksTheHeadUntilDue() async throws {
        let store = try makeStore()
        try enqueue(store, 2)
        let clock = Clock()
        let executor = ScriptedExecutor(failures: [1: NetworkError("offline")])
        let drainer = makeDrainer(store, executor, clock: clock)

        await drainer.drain()
        XCTAssertEqual(executor.executed, [1], "stops at the first failure so op 2 is not skipped ahead")
        var head = try XCTUnwrap(try store.outboxHead())
        XCTAssertEqual(head.attempts, 1)
        XCTAssertNotNil(head.nextAttemptAt)

        await drainer.drain()
        XCTAssertEqual(executor.executed, [1], "head is still backing off")

        clock.advance(3)
        await drainer.drain()
        head = try XCTUnwrap(try store.outboxHead())
        XCTAssertEqual(head.attempts, 2)

        executor.fail(1, with: nil)
        clock.advance(10)
        await drainer.drain()
        XCTAssertEqual(try store.outboxRows().count, 0)
    }

    func testBackoffCurveCapsAtSixtySeconds() {
        XCTAssertEqual(OutboxDrainer.backoff(attempts: 1), 2)
        XCTAssertEqual(OutboxDrainer.backoff(attempts: 3), 8)
        XCTAssertEqual(OutboxDrainer.backoff(attempts: 6), 60)
        XCTAssertEqual(OutboxDrainer.backoff(attempts: 40), 60)
    }

    func testNonRetryableErrorGoesStraightToDeadLetter() async throws {
        let store = try makeStore()
        try enqueue(store, 1)
        let executor = ScriptedExecutor(failures: [1: ApiError(status: 400, code: nil, message: "bad", retryable: false)])
        await makeDrainer(store, executor).drain()
        XCTAssertEqual(try store.outboxRows().count, 0)
        let dead = try store.deadLetters()
        XCTAssertEqual(dead.count, 1)
        XCTAssertEqual(dead.first?.attempts, 1)
    }

    func testRetryBudgetExhaustionDeadLetters() async throws {
        let store = try makeStore()
        try enqueue(store, 1)
        try runSQL(store, "UPDATE outbox SET attempts = 9")
        let executor = ScriptedExecutor(failures: [1: NetworkError("offline")])
        await makeDrainer(store, executor).drain()
        XCTAssertEqual(try store.deadLetters().count, 1)
        XCTAssertEqual(try store.outboxRows().count, 0)
    }

    func testDependencyBlockDoesNotUseAnAttempt() async throws {
        let store = try makeStore()
        try enqueue(store, 1)
        try runSQL(store, "UPDATE outbox SET attempts = 9")
        let blocked = ApiError(status: 0, code: nil, message: "parent not synced", retryable: true, dependency: true)
        await makeDrainer(store, ScriptedExecutor(failures: [1: blocked])).drain()
        let head = try XCTUnwrap(try store.outboxHead())
        XCTAssertEqual(head.attempts, 9)
        XCTAssertEqual(try store.deadLetters().count, 0)
    }

    func testUnknownEntityTypeIsDeadLetteredNotDropped() async throws {
        let store = try makeStore()
        try store.database.writer.write {
            try $0.enqueue(.view, localId: "v", operation: .create, payload: [:], at: isoNow())
        }
        await makeDrainer(store, ScriptedExecutor()).drain()
        XCTAssertEqual(try store.deadLetters().count, 1)
    }

    func testConcurrentDrainsRunOnce() async throws {
        let store = try makeStore()
        try enqueue(store, 1)
        let executor = ScriptedExecutor(delay: 50_000_000)
        let drainer = makeDrainer(store, executor)
        async let one: Void = drainer.drain()
        async let two: Void = drainer.drain()
        _ = await (one, two)
        XCTAssertEqual(executor.executed, [1])
    }

    func testRetryAndDiscardDeadLetters() async throws {
        let store = try makeStore()
        try enqueue(store, 1)
        let executor = ScriptedExecutor(failures: [1: ApiError(status: 400, code: nil, message: "bad", retryable: false)])
        await makeDrainer(store, executor).drain()
        let dead = try XCTUnwrap(try store.deadLetters().first)
        XCTAssertTrue(try store.retryDeadLetter(id: dead.id))
        XCTAssertEqual(try store.outboxRows().count, 1)
        XCTAssertEqual(try store.outboxRows().first?.attempts, 0)
        XCTAssertFalse(try store.retryDeadLetter(id: 999))
        let head = try XCTUnwrap(try store.outboxHead())
        try store.discardOutboxOp(id: head.id)
        XCTAssertEqual(try store.outboxRows().count, 0)
    }
}
