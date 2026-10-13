import GRDB
import XCTest
@testable import CriaKit

private final class SignOutCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    var count: Int { lock.withLock { value } }
    func bump() { lock.withLock { value += 1 } }
}

/// S-92 scenario 2: the token expires while the outbox is draining.
final class TokenExpiryScenarioTests: XCTestCase {
    private let password = Credentials(serverURL: "https://vk.example", token: "tok1", authMethod: .password, refreshToken: "ref1")

    private func makeAuth(_ server: ScenarioServer, signedOut: SignOutCounter = SignOutCounter()) async throws -> AuthSession {
        let store = CredentialStore(slot: MemorySlot())
        try store.save(password)
        let auth = AuthSession(store: store, core: HTTPCore(transport: server.transport), onSignOut: { signedOut.bump() })
        await auth.hydrate()
        return auth
    }

    func testA401OnTheThirdOpRefreshesAndTheDrainContinuesWithoutLossOrDuplicates() async throws {
        let server = ScenarioServer()
        server.requireToken("tok1", refresh: .issue("tok2"))
        // The server expires the token as the third create arrives.
        server.fail(times: 1, with: .status(401, "token expired")) { $0.method == "PUT" && $0.title == "Task 3" }
        let auth = try await makeAuth(server)
        let rig = try Rig(session: auth, server: server)
        for number in 1...5 { try rig.create("Task \(number)") }

        await rig.drainer.drain()

        XCTAssertEqual(server.applied, (1...5).map { "create Task \($0)" }, "each op applied exactly once, in order")
        XCTAssertEqual(server.refreshCalls, 1)
        XCTAssertTrue(try rig.store.outboxRows().isEmpty)
        XCTAssertTrue(try rig.store.deadLetters().isEmpty)
        XCTAssertEqual(try rig.dirtyCount(), 0)
        XCTAssertEqual(try rig.unsyncedCount(), 0)
        let status = await auth.status
        XCTAssertEqual(status, .authenticated(Credentials(
            serverURL: "https://vk.example", token: "tok2", authMethod: .password, refreshToken: "ref1")))
        // The op that hit the 401 (sent with tok1) was retried once, with the new token; later ops used the new token
        // from the start.
        let creates = server.transport.requests.filter { $0.httpMethod == "PUT" }.map { header($0, "Authorization") }
        XCTAssertEqual(creates, ["Bearer tok1", "Bearer tok1", "Bearer tok1", "Bearer tok2", "Bearer tok2", "Bearer tok2"])
    }

    func testARefreshThatFailsThreeTimesSignsOutAndLosesNothing() async throws {
        let server = ScenarioServer()
        server.requireToken("a-token-the-client-never-has", refresh: .reject)
        let signedOut = SignOutCounter()
        let auth = try await makeAuth(server, signedOut: signedOut)
        let rig = try Rig(session: auth, server: server)
        let titles = ["First", "Second", "Third"]
        for title in titles { try rig.create(title) }
        let ids = try rig.store.outboxRows().map(\.id)

        for round in 1...3 {
            await rig.drain()
            XCTAssertTrue(try rig.store.deadLetters().isEmpty, "round \(round): a 401 is not the op's fault")
            XCTAssertEqual(try rig.store.outboxRows().map(\.id), ids, "round \(round)")
        }
        XCTAssertEqual(server.refreshCalls, 3)
        XCTAssertEqual(signedOut.count, 1)
        let status = await auth.status
        XCTAssertEqual(status, .unauthenticated)

        // Signed out: the drain now fails before reaching the network, and still keeps everything.
        await rig.drain()
        XCTAssertEqual(try rig.store.outboxRows().map(\.id), ids)
        XCTAssertTrue(try rig.store.deadLetters().isEmpty)
        XCTAssertTrue(try rig.store.outboxRows().allSatisfy { $0.attempts == 0 })
        XCTAssertTrue(server.applied.isEmpty)

        // Signing back in resumes the queue, in order.
        server.requireToken("tok3", refresh: .reject)
        try await auth.signIn(Credentials(serverURL: "https://vk.example", token: "tok3", authMethod: .password, refreshToken: "ref3"))
        await rig.drain()
        XCTAssertEqual(server.applied, titles.map { "create \($0)" })
        XCTAssertTrue(try rig.store.outboxRows().isEmpty)
    }

    func testARevokedApiTokenKeepsTheQueueAndDeadLettersNothing() async throws {
        let server = ScenarioServer()
        server.requireToken("another", refresh: .reject)
        let session = FakeSession(token: "revoked")
        let rig = try Rig(session: session, server: server)
        try rig.create("Kept")
        await rig.drain()
        XCTAssertEqual(try rig.store.outboxRows().count, 1)
        XCTAssertTrue(try rig.store.deadLetters().isEmpty)
        let unauthorised = await session.unauthorizedCount
        XCTAssertEqual(unauthorised, 1)
    }
}

/// S-92 scenario 3: server errors and timeouts.
final class ServerFailureScenarioTests: XCTestCase {
    func testFiveHundredsBackOffThenDeadLetterAndTheDeadLetterCanBeRetried() async throws {
        let rig = try Rig()
        let flaky = try rig.create("Flaky")
        rig.server.fail(with: .status(503, "maintenance")) { $0.method == "PUT" && $0.title == "Flaky" }
        try rig.create("Behind")

        for round in 1...9 {
            await rig.drain()
            let head = try XCTUnwrap(try rig.store.outboxHead())
            XCTAssertEqual(head.attempts, round)
            XCTAssertTrue(try rig.store.deadLetters().isEmpty, "round \(round): still inside the budget")
        }
        XCTAssertEqual(rig.server.attempts, Array(repeating: "create Flaky", count: 9))
        XCTAssertTrue(rig.server.applied.isEmpty, "the failing head holds back the op behind it")

        await rig.drain()  // the 10th failure spends the budget
        let dead = try XCTUnwrap(try rig.store.deadLetters().first)
        XCTAssertEqual(dead.attempts, 10)
        XCTAssertEqual(dead.op, "create")
        XCTAssertTrue(dead.lastError?.contains("maintenance") == true)
        XCTAssertEqual(try rig.store.outboxRows().count, 1)

        await rig.drain()  // the op behind it is free to go
        XCTAssertEqual(rig.server.applied, ["create Behind"])
        let local = try XCTUnwrap(try rig.row(flaky))
        XCTAssertNil(local.serverId, "the dead-lettered create has not reached the server")

        rig.server.clearFaults()
        XCTAssertTrue(try rig.store.retryDeadLetter(id: dead.id))
        XCTAssertTrue(try rig.store.deadLetters().isEmpty)
        let revived = try XCTUnwrap(try rig.store.outboxHead())
        XCTAssertEqual(revived.attempts, 0, "a retried op gets a fresh budget")
        await rig.drain()
        XCTAssertEqual(rig.server.applied, ["create Behind", "create Flaky"])
        XCTAssertEqual(try rig.row(flaky)?.serverId, 101)
        XCTAssertEqual(try rig.dirtyCount(), 0)
        XCTAssertTrue(try rig.store.outboxRows().isEmpty)
    }

    func testBackoffDoublesBetweenFailuresAndTheOpLandsOnceTheServerRecovers() async throws {
        let rig = try Rig()
        try rig.create("Recovering")
        rig.server.fail(times: 3, with: .status(500, "boom"))
        for expected in [2.0, 4.0, 8.0] {
            await rig.drainer.drain()
            let head = try XCTUnwrap(try rig.store.outboxHead())
            let due = try Date(XCTUnwrap(head.nextAttemptAt), strategy: .iso8601)
            XCTAssertEqual(due.timeIntervalSince(rig.clock.now), expected, accuracy: 1.0)
            let before = rig.server.attempts.count
            await rig.drainer.drain()
            XCTAssertEqual(rig.server.attempts.count, before, "inside the backoff window the server is left alone")
            rig.clock.advance(expected + 1)
        }
        await rig.drainer.drain()
        XCTAssertEqual(rig.server.applied, ["create Recovering"])
        XCTAssertTrue(try rig.store.outboxRows().isEmpty)
        XCTAssertTrue(try rig.store.deadLetters().isEmpty)
    }

    /// By design, `isOfflineError` covers `.timedOut`, so a timeout never uses an attempt (same as being offline).
    func testTimeoutsAreTreatedLikeBeingOfflineAndNeverDeadLetter() async throws {
        let rig = try Rig()
        let task = try rig.create("Slow")
        rig.server.fail(with: .timeout) { $0.method == "PUT" }
        for _ in 1...14 { await rig.drain() }
        let head = try XCTUnwrap(try rig.store.outboxHead())
        XCTAssertEqual(head.attempts, 0)
        XCTAssertTrue(try rig.store.deadLetters().isEmpty)
        XCTAssertEqual(rig.server.attempts.count, 14)
        rig.server.clearFaults()
        await rig.drain()
        XCTAssertEqual(rig.server.applied, ["create Slow"])
        XCTAssertEqual(try rig.row(task)?.serverId, 100)
    }
}

/// S-92 scenario 4: a 4xx that will never succeed.
final class PermanentFailureScenarioTests: XCTestCase {
    private func makeRigWithSharedProject() throws -> (Rig, shared: String, sharedTask: String) {
        let rig = try Rig()
        let shared = try seedProject(rig.store, serverId: 2, title: "Shared (read only)")
        // The local copy is the server's own JSON, as a pull would store it, so the pre-push check sees no change.
        let task = rig.server.seed(id: 70, project: 2, title: "Their task")
        let json = String(bytes: try JSONSerialization.data(withJSONObject: task), encoding: .utf8) ?? ""
        let localId = try rig.store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
        rig.server.markReadOnly(project: 2)
        return (rig, shared, try XCTUnwrap(localId))
    }

    func testA403DeadLettersImmediatelyAndTheOpsBehindItContinue() async throws {
        let (rig, _, theirs) = try makeRigWithSharedProject()
        try rig.store.updateTask(localId: theirs, patch: TaskPatch(title: "My edit"))
        try rig.create("Mine")
        let mine2 = try rig.create("Mine too")

        await rig.drain()
        let dead = try XCTUnwrap(try rig.store.deadLetters().first)
        XCTAssertEqual(dead.attempts, 1, "a 4xx is not retried")
        XCTAssertEqual(dead.op, "update")
        XCTAssertEqual(try rig.store.outboxRows().count, 2, "this drain stopped at the failure (the bus triggers the next one)")

        await rig.drain()
        XCTAssertEqual(rig.server.applied, ["create Mine", "create Mine too"])
        XCTAssertEqual(try rig.store.deadLetters().count, 1)
        XCTAssertTrue(try rig.store.outboxRows().isEmpty)
        XCTAssertEqual(try rig.row(mine2)?.serverId, 101)
    }

    /// In the running app the dead-letter announces `.outbox`, which starts the next drain by itself.
    func testTheBusKicksTheNextDrainAfterADeadLetter() async throws {
        let (rig, _, theirs) = try makeRigWithSharedProject()
        await rig.coordinator.start(interval: 3600, reconcileInterval: 3600)
        try rig.store.updateTask(localId: theirs, patch: TaskPatch(title: "My edit"))
        try rig.create("Mine")
        let landed = await waitUntil { rig.server.applied == ["create Mine"] }
        XCTAssertTrue(landed)
        XCTAssertEqual(try rig.store.deadLetters().count, 1)
        await rig.coordinator.stop()
    }

    /// By design: the failed edit stays on the device, still dirty, so a pull never overwrites it.
    func testADeadLetteredEditStaysLocalAndDirty() async throws {
        let (rig, _, theirs) = try makeRigWithSharedProject()
        try rig.store.updateTask(localId: theirs, patch: TaskPatch(title: "My edit"))
        await rig.drain()
        XCTAssertEqual(try rig.store.deadLetters().count, 1)
        rig.server.edit(70, title: "Their newer title")
        try await rig.puller.pullAllTasks()
        XCTAssertEqual(try rig.row(theirs)?.title, "My edit")
        let dirty = try await rig.store.database.writer.read { connection in
            try Bool.fetchOne(connection, sql: "SELECT dirty FROM tasks WHERE local_id = ?", arguments: [theirs])
        }
        XCTAssertEqual(dirty, true)
    }
}
