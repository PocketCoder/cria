import GRDB
import XCTest
@testable import CriaKit

private final class CountingExecutor: OutboxExecutor, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    var runs: Int { lock.withLock { count } }

    func execute(_ op: OutboxRow, api: ApiClient, store: CriaStore) async throws {
        lock.withLock { count += 1 }
        try await Task.sleep(nanoseconds: 50_000_000)
    }
}

private struct LockedSlot: SecretSlot {
    func read() throws -> String? { throw NetworkError("locked") }
    func write(_ value: String) throws {}
    func delete() throws {}
}

/// Regressions found in review: sync data loss and queue stalls.
final class SyncFixesTests: XCTestCase {
    private func clean(_ store: CriaStore, id: Int = 1) throws -> String {
        let json = taskJSON(id: id, title: "T\(id)")
        return try XCTUnwrap(store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json))
    }

    private func reminderCount(_ store: CriaStore, _ taskLocalId: String) throws -> Int {
        try store.database.writer.read { connection in
            try Int.fetchOne(
                connection, sql: "SELECT COUNT(*) FROM task_reminders WHERE task_local_id = ?", arguments: [taskLocalId]
            ) ?? 0
        }
    }

    // MARK: Reminders and relations

    func testPullKeepsRemindersOfATaskWithPendingEdits() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Dirty", projectLocalId: project))
        try runSQL(store, "INSERT INTO task_reminders (task_local_id, reminder_at, notified) VALUES (?, '2030-01-01T09:00:00Z', 0)",
                   [task.localId])
        try store.replaceRemindersFromServer(taskLocalId: task.localId, [])
        XCTAssertEqual(try reminderCount(store, task.localId), 1)
    }

    func testPullKeepsFiredFlagOfAnUnchangedReminder() throws {
        let store = try makeStore()
        try seedProject(store)
        let taskLocalId = try clean(store)
        try runSQL(store, "INSERT INTO task_reminders (task_local_id, reminder_at, notified) VALUES (?, '2026-06-10T09:00:00Z', 1)",
                   [taskLocalId])
        let reminders = try decodeFixture(TaskResponse.self, """
        {"id": 1, "project_id": 1, "title": "x", "reminders": [{"reminder": "2026-06-10T09:00:00Z"}]}
        """).reminders ?? []
        try store.replaceRemindersFromServer(taskLocalId: taskLocalId, reminders)
        let notified = try store.database.writer.read { connection in
            try Int.fetchOne(connection, sql: "SELECT notified FROM task_reminders WHERE task_local_id = ?", arguments: [taskLocalId])
        }
        XCTAssertEqual(notified, 1)
    }

    func testPullKeepsRelationsWhileAnOpIsQueued() throws {
        let store = try makeStore()
        try seedProject(store)
        let first = try clean(store, id: 1)
        let second = try clean(store, id: 2)
        try store.addRelation(taskLocalId: first, otherTaskLocalId: second, kind: .related)
        try runSQL(store, "UPDATE tasks SET dirty = 0")
        try store.replaceRelationsFromServer(taskLocalId: first, [:])
        let kept = try store.database.writer.read { connection in
            try Int.fetchOne(connection, sql: "SELECT COUNT(*) FROM task_relations WHERE task_local_id = ?", arguments: [first])
        }
        XCTAssertEqual(kept, 1)
    }

    // MARK: Create with an edit in flight

    func testCreateKeepsServerIdAndDirtyWhenEditedInFlight() throws {
        let store = try makeStore()
        try seedProject(store, serverId: 4, title: "Edited")
        try runSQL(store, "UPDATE projects SET server_id = NULL, dirty = 1, updated_at = 'edited'")
        let localId = try XCTUnwrap(store.projects().first?.localId)
        try store.markCreated(table: "projects", localId: localId, serverId: 9, updatedAt: "server",
                              onlyIfUnchangedSince: "older", announcing: .projects)
        let row = try store.database.writer.read { try Row.fetchOne($0, sql: "SELECT server_id, dirty, updated_at FROM projects") }
        XCTAssertEqual(row?["server_id"] as Int?, 9)
        XCTAssertEqual(row?["dirty"] as Bool?, true)
        XCTAssertEqual(row?["updated_at"] as String?, "edited")
    }

    func testCreateClearsDirtyWhenUnchanged() throws {
        let store = try makeStore()
        try seedProject(store, serverId: 4, title: "Plain")
        try runSQL(store, "UPDATE projects SET server_id = NULL, dirty = 1, updated_at = 'same'")
        let localId = try XCTUnwrap(store.projects().first?.localId)
        try store.markCreated(table: "projects", localId: localId, serverId: 9, updatedAt: "server",
                              onlyIfUnchangedSince: "same", announcing: .projects)
        let row = try store.database.writer.read { try Row.fetchOne($0, sql: "SELECT server_id, dirty FROM projects") }
        XCTAssertEqual(row?["server_id"] as Int?, 9)
        XCTAssertEqual(row?["dirty"] as Bool?, false)
    }

    func testTaskStaysDirtyWhenAnotherOpIsQueued() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Busy", projectLocalId: project))
        let ops = try outboxRows(store)
        XCTAssertEqual(ops.count, 1)
        try store.database.writer.write { connection in
            try connection.enqueue(.task, localId: task.localId, operation: .update, payload: [:], at: isoNow())
        }
        let firstOp = try XCTUnwrap(store.outboxHead()).id
        try store.markTaskSynced(localId: task.localId, serverId: 5, updatedAt: "server", lastSynced: "{}", opId: firstOp)
        let row = try store.database.writer.read { try Row.fetchOne($0, sql: "SELECT dirty, last_synced, server_id FROM tasks") }
        XCTAssertEqual(row?["dirty"] as Bool?, true)
        XCTAssertEqual(row?["last_synced"] as String?, "{}")
        XCTAssertEqual(row?["server_id"] as Int?, 5)
    }

    /// The CI flake in `testTheBusKicksTheNextDrainAfterADeadLetter`: a pull stored the task the create had just
    /// made before the push recorded its server id, so recording it failed the UNIQUE index.
    func testMarkSyncedReplacesTheCopyAPullStoredMidCreate() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Mine", projectLocalId: project))
        let json = taskJSON(id: 101, title: "Mine")
        let copy = try XCTUnwrap(try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json))
        XCTAssertNotEqual(copy, task.localId)
        try store.markTaskSynced(localId: task.localId, serverId: 101, updatedAt: nil)
        let rows = try store.database.writer.read { try Row.fetchAll($0, sql: "SELECT local_id, server_id FROM tasks") }
        XCTAssertEqual(rows.map { $0["local_id"] as String }, [task.localId])
        XCTAssertEqual(rows.first?["server_id"] as Int?, 101)
    }

    // MARK: Queue stalls

    func testLinkOpForADeletedTaskFinishesAsANoOp() async throws {
        let store = try makeStore()
        try await store.database.writer.write { connection in
            try connection.enqueue(
                .taskLabel, localId: "gone:label", operation: .create,
                payload: ["task_local_id": "gone", "label_local_id": "label"], at: isoNow()
            )
        }
        let head = try XCTUnwrap(store.outboxHead())
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: StubTransport { _, _ in (500, "{}", [:]) }))
        try await TaskLinkExecutor().execute(head, api: api, store: store)
    }

    func testOverlappingDrainsShareOneRun() async throws {
        let store = try makeStore()
        try await store.database.writer.write { connection in
            try connection.enqueue(.task, localId: "t1", operation: .create, payload: [:], at: isoNow())
        }
        let executor = CountingExecutor()
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: StubTransport { _, _ in (200, "{}", [:]) }))
        let drainer = OutboxDrainer(api: api, store: store, executors: ["task": executor])
        async let first: Void = drainer.drain()
        async let second: Void = drainer.drain()
        _ = await (first, second)
        XCTAssertEqual(executor.runs, 1)
        XCTAssertEqual(try store.outboxRows().count, 0)
    }

    // MARK: Reconcile

    func testReconcileSkipsQueuedAndFreshlySyncedTasks() throws {
        let store = try makeStore()
        try seedProject(store)
        let gone = try clean(store, id: 1)
        let queued = try clean(store, id: 2)
        let fresh = try clean(store, id: 3)
        try store.database.writer.write { connection in
            try connection.enqueue(.task, localId: queued, operation: .update, payload: [:], at: isoNow())
        }
        try runSQL(store, "UPDATE tasks SET synced_at = '2999-01-01T00:00:00Z' WHERE local_id = ?", [fresh])
        try store.removeTasksMissingOnServer(serverIds: [], fetchedSince: "2500-01-01T00:00:00Z")
        let left = try store.database.writer.read { try String.fetchAll($0, sql: "SELECT local_id FROM tasks") }
        XCTAssertFalse(left.contains(gone))
        XCTAssertTrue(left.contains(queued))
        XCTAssertTrue(left.contains(fresh))
    }

    // MARK: Decoding, auth, transport

    func testOneBadNestedItemDoesNotDropTheTask() throws {
        let task = try decodeFixture(TaskResponse.self, """
        {"id": 1, "project_id": 1, "title": "x", "labels": [{"id": 1, "title": "ok"}, {"title": 5}, "junk"],
         "related_tasks": {"subtask": [{"id": 2}, {"title": "no id"}]}}
        """)
        XCTAssertEqual(task.labels?.count, 1)
        XCTAssertEqual(task.relatedTasks?["subtask"]?.count, 1)
    }

    func testLockedKeychainIsNotSignedOut() async {
        let store = CredentialStore(slot: LockedSlot())
        guard case .unavailable = store.loadResult() else { return XCTFail("expected unavailable") }
        let session = AuthSession(store: store)
        await session.hydrate()
        let unavailable = await session.credentialsUnavailable
        XCTAssertTrue(unavailable)
    }

    func testCancelledRequestsDoNotOpenTheBreaker() async throws {
        let transport = StubTransport { _, index in
            if index <= 6 { throw CancellationError() }
            return (200, "{}", [:])
        }
        let core = HTTPCore(transport: transport)
        let request = URLRequest(url: try XCTUnwrap(URL(string: "https://vk.example/api/v1/info")))
        for _ in 0..<6 {
            do { _ = try await core.fetchOnce(request) } catch { XCTAssertTrue(error is CancellationError) }
        }
        let response = try await core.fetchOnce(request)
        XCTAssertEqual(response.status, 200)
    }

    // MARK: Shared database

    func testSecondProcessCanOpenTheFileReadOnlyWithoutMigrating() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("cria-\(UUID().uuidString).sqlite")
        defer { for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: url.path + suffix) } }
        let app = CriaStore(database: try CriaDatabase.open(at: url))
        try seedProject(app)
        let widget = CriaStore(database: try CriaDatabase.open(at: url, migrate: false, readOnly: true))
        XCTAssertEqual(try widget.projects().count, 1)
    }

    func testCrossProcessSignalIsHeard() {
        let heard = expectation(description: "signal")
        heard.assertForOverFulfill = false
        let signal = CrossProcessSignal { heard.fulfill() }
        CrossProcessSignal.post()
        wait(for: [heard], timeout: 5)
        withExtendedLifetime(signal) {}
    }
}
