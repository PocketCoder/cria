import GRDB
import XCTest
@testable import CriaKit

final class TaskExecutorTests: XCTestCase {
    private func setUpStore() throws -> (CriaStore, StubServer, ApiClient, String) {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 1)
        let server = StubServer()
        return (store, server, server.api(), project)
    }

    private func drain(_ store: CriaStore, _ api: ApiClient) async {
        let drainer = OutboxDrainer(api: api, store: store, executors: [
            "task": TaskExecutor(), "task_label": TaskLinkExecutor()
        ])
        await drainer.drain()
    }

    func testCreatePushesBodyAndStoresServerId() async throws {
        let (store, server, api, project) = try setUpStore()
        server.json("PUT /projects/1/tasks", #"{"id": 55, "project_id": 1, "title": "New", "updated": "2026-06-09T10:00:00Z"}"#)
        let task = try store.createTask(TaskInput(title: "New", projectLocalId: project, dueDate: "2026-06-09T12:00:00+01:00"))
        await drain(store, api)
        let stored = try XCTUnwrap(try store.task(localId: task.localId))
        XCTAssertEqual(stored.serverId, 55)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM outbox"), 0)
        let request = try XCTUnwrap(server.requests.first)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(body["title"] as? String, "New")
        XCTAssertEqual(body["project_id"] as? Int, 1)
        XCTAssertEqual(body["is_favorite"] as? Bool, false)
    }

    func testCreateInUnsyncedProjectBlocksWithoutUsingAttempt() async throws {
        let store = try makeStore()
        let server = StubServer()
        let project = try seedProject(store, serverId: 1)
        try runSQL(store, "UPDATE projects SET server_id = NULL")
        _ = try store.createTask(TaskInput(title: "T", projectLocalId: project))
        await drain(store, server.api())
        let head = try XCTUnwrap(try store.outboxHead())
        XCTAssertEqual(head.attempts, 0)
        XCTAssertTrue(server.requests.isEmpty)
    }

    func testCrashedCreateReusesCachedServerId() async throws {
        let (store, server, api, project) = try setUpStore()
        let task = try store.createTask(TaskInput(title: "T", projectLocalId: project))
        let head = try XCTUnwrap(try store.outboxHead())
        try store.cacheCreateResponse(opId: head.id, payload: head.payload, serverId: 77)
        await drain(store, api)
        XCTAssertTrue(server.requests.isEmpty, "no API call when the id is cached")
        XCTAssertEqual(try store.task(localId: task.localId)?.serverId, 77)
    }

    func testUpdatePostsFullBodyWithReminders() async throws {
        let (store, server, api, _) = try setUpStore()
        let local = try seedSyncedTask(store, serverId: 9, title: "Old")
        try runSQL(store, "INSERT INTO task_reminders (task_local_id, reminder_at, notified) VALUES (?, '2026-06-10T09:00:00Z', 0)", [local])
        server.json("POST /tasks/9", #"{"id": 9, "project_id": 1, "title": "Renamed", "updated": "2026-06-11T10:00:00Z"}"#)
        try store.updateTask(localId: local, patch: TaskPatch(title: "Renamed"))
        await drain(store, api)
        let request = try XCTUnwrap(server.requests.last { $0.httpMethod == "POST" })
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(body["title"] as? String, "Renamed")
        XCTAssertEqual((body["reminders"] as? [[String: Any]])?.count, 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE dirty = 1"), 0)
    }

    func testUpdateAbortsOnDivergenceAndRecordsConflict() async throws {
        let (store, server, api, _) = try setUpStore()
        let local = try seedSyncedTask(store, serverId: 9, title: "Old")
        server.json("GET /tasks/9", #"{"id": 9, "project_id": 1, "title": "Changed on server"}"#)
        server.json("POST /tasks/9", #"{"id": 9, "project_id": 1, "title": "x"}"#)
        try store.updateTask(localId: local, patch: TaskPatch(title: "Mine"))
        await drain(store, api)
        XCTAssertFalse(server.requests.contains { $0.httpMethod == "POST" })
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM conflicts WHERE entity_local_id = ?", [local]), 1)
    }

    func testDeleteIgnores404AndRemovesLocalRow() async throws {
        let (store, server, api, _) = try setUpStore()
        let local = try seedSyncedTask(store, serverId: 9)
        server.json("DELETE /tasks/9", #"{"message":"gone"}"#, status: 404)
        try store.deleteTask(localId: local)
        await drain(store, api)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks"), 0)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM outbox"), 0)
    }

    func testDeleteOfNeverSyncedTaskNeedsNoRequest() async throws {
        let (store, server, api, project) = try setUpStore()
        let task = try store.createTask(TaskInput(title: "Local only", projectLocalId: project))
        try runSQL(store, "DELETE FROM outbox")
        try store.deleteTask(localId: task.localId)
        await drain(store, api)
        XCTAssertTrue(server.requests.isEmpty)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks"), 0)
    }

    func testLabelToggleAddsThenRemoves() async throws {
        let (store, server, api, _) = try setUpStore()
        let task = try seedSyncedTask(store, serverId: 9)
        let labelJSON = #"{"id": 7, "title": "Home"}"#
        let label = try store.upsertLabelFromServer(try decodeFixture(LabelResponse.self, labelJSON), rawJSON: labelJSON)
        server.json("PUT /tasks/9/labels", "{}")
        server.json("DELETE /tasks/9/labels/7", "{}")
        try store.toggleTaskLabel(taskLocalId: task, labelLocalId: label)
        try store.toggleTaskLabel(taskLocalId: task, labelLocalId: label)
        await drain(store, api)
        XCTAssertEqual(server.requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" },
                       ["PUT /api/v1/tasks/9/labels", "DELETE /api/v1/tasks/9/labels/7"])
    }

    func testLabelOpBlocksUntilLabelHasServerId() async throws {
        let (store, server, api, _) = try setUpStore()
        let task = try seedSyncedTask(store, serverId: 9)
        let label = UUID().uuidString
        try runSQL(store, "INSERT INTO labels (local_id, title, updated_at, dirty, deleted) VALUES (?, 'New', '2026-01-01T00:00:00Z', 1, 0)", [label])
        try store.toggleTaskLabel(taskLocalId: task, labelLocalId: label)
        await drain(store, api)
        XCTAssertTrue(server.requests.isEmpty)
        XCTAssertEqual(try store.outboxHead()?.attempts, 0)
    }
}
