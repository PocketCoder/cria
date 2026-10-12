import XCTest
@testable import CriaKit

/// S-92 scenario 1: airplane mode. Every write is queued locally, nothing is lost or reordered while the transport
/// throws, and everything lands in order when the network returns.
final class AirplaneModeScenarioTests: XCTestCase {
    func testOfflineEditsQueueUntouchedThenLandInOrder() async throws {
        let rig = try Rig()
        let existing = try rig.seedServerTask(id: 50, title: "Existing")
        let chore = try rig.seedServerTask(id: 51, title: "Old chore")
        rig.server.setNetworkDown(true)

        let milk = try rig.create("Buy milk")
        let bank = try rig.create("Call bank")
        try rig.store.updateTask(localId: existing, patch: TaskPatch(title: "Existing (edited)"))
        try rig.store.updateTask(localId: bank, patch: TaskPatch(done: true))
        try rig.store.updateTask(localId: milk, patch: TaskPatch(title: "Buy oat milk"))
        try rig.store.deleteTask(localId: chore)
        var expectedIds = try rig.store.outboxRows().map(\.id)
        XCTAssertEqual(expectedIds.count, 6)

        for round in 1...8 {
            await rig.tick()
            if round == 4 {
                try rig.create("Plan trip")  // more work while still offline: it queues behind the rest
                expectedIds = try rig.store.outboxRows().map(\.id)
            }
            let rows = try rig.store.outboxRows()
            XCTAssertEqual(rows.map(\.id), expectedIds, "round \(round): nothing dropped or reordered")
            XCTAssertTrue(rows.allSatisfy { $0.attempts == 0 }, "round \(round): offline never uses an attempt")
            XCTAssertTrue(try rig.store.deadLetters().isEmpty, "round \(round)")
            XCTAssertTrue(rig.server.applied.isEmpty)
        }
        XCTAssertEqual(try rig.dirtyCount(), 5, "every local change is still marked dirty")

        rig.server.setNetworkDown(false)
        await rig.tick()

        // The executor sends the row as it is when the op runs, so the create already carries the later edits.
        XCTAssertEqual(rig.server.applied, [
            "create Buy oat milk", "create Call bank",
            "update 50 Existing (edited) done=false", "update 101 Call bank done=true", "update 100 Buy oat milk done=false",
            "delete 51", "create Plan trip"
        ])
        XCTAssertTrue(try rig.store.outboxRows().isEmpty)
        XCTAssertTrue(try rig.store.deadLetters().isEmpty)
        XCTAssertEqual(try rig.dirtyCount(), 0)
        XCTAssertEqual(try rig.unsyncedCount(), 0, "every created task has its server id")
        XCTAssertEqual(try countRows(rig.store, "SELECT COUNT(*) FROM tasks"), 4, "the deleted chore is gone, nothing duplicated")
        XCTAssertEqual(rig.server.taskIds.count, 4)
        XCTAssertEqual(try rig.row(milk)?.title, "Buy oat milk")
        XCTAssertEqual(try rig.row(milk)?.serverId, 100)
        XCTAssertEqual(try rig.row(bank)?.done, true)
    }

    /// The circuit breaker opens after repeated failures. Its cooldown only delays the retry, it never loses an op.
    func testBreakerCooldownAfterLongOutageOnlyDelaysTheRetry() async throws {
        let rig = try Rig()
        rig.server.setNetworkDown(true)
        try rig.create("Offline task")
        for _ in 1...6 { await rig.drain(advance: 2) }  // each retry reaches the transport: the breaker trips at the 4th
        XCTAssertEqual(try rig.store.outboxHead()?.attempts, 0)
        XCTAssertEqual(rig.server.transportAttempts, 4, "the breaker stopped the last two calls reaching the network")
        rig.server.setNetworkDown(false)
        await rig.drain(advance: 2)
        XCTAssertTrue(rig.server.applied.isEmpty, "the breaker is still cooling down")
        rig.clock.advance(65)
        await rig.drain()
        XCTAssertEqual(rig.server.applied, ["create Offline task"])
    }

    func testReconnectingMidSessionDrainsViaTheOutboxTrigger() async throws {
        let rig = try Rig()
        await rig.coordinator.start(interval: 3600, reconcileInterval: 3600)
        rig.server.setNetworkDown(true)
        try rig.create("Queued offline")
        _ = try await waitUntil { try rig.store.outboxHead()?.lastError != nil }
        rig.server.setNetworkDown(false)
        rig.clock.advance(65)
        // Any later outbox change triggers a drain, and the earlier op goes first.
        try rig.create("Queued online")
        let landed = await waitUntil { rig.server.applied.count == 2 }
        XCTAssertTrue(landed)
        XCTAssertEqual(rig.server.applied, ["create Queued offline", "create Queued online"])
        await rig.coordinator.stop()
    }
}
