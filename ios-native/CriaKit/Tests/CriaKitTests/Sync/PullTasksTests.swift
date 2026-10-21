import GRDB
import XCTest
@testable import CriaKit

final class PullTasksTests: XCTestCase {
    private let taskBody = """
        [{"id": 100, "project_id": 1, "title": "Write", "updated": "2026-06-09T10:00:00Z",
          "labels": [{"id": 7, "title": "Home"}],
          "assignees": [{"id": 3, "username": "sam"}],
          "reminders": [{"reminder": "2026-06-10T09:00:00Z"}],
          "attachments": [{"id": 5, "task_id": 100, "file": {"id": 9, "name": "a.png", "size": 10, "mime": "image/png"}}],
          "comments": [{"id": 11, "comment": "hi", "author": {"id": 3, "username": "sam"}}],
          "related_tasks": {"related": [{"id": 101, "title": "Other", "project_id": 1}]}}]
        """

    private func makePuller() throws -> (Puller, CriaStore, StubServer) {
        let store = try makeStore()
        try seedProject(store)
        let server = StubServer()
        return (Puller(api: server.api(), store: store), store, server)
    }

    func testPullAllTasksStoresRelationsSilentlyAndIsIdempotent() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /tasks", taskBody)
        try await assertNoBusEvents(store) {
            let count = try await puller.pullAllTasks()
            XCTAssertEqual(count, 1)
        }
        try await puller.pullAllTasks()
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks"), 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM labels"), 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM task_labels"), 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM task_assignees"), 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM task_reminders"), 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM task_attachments"), 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM task_comments"), 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM task_relations"), 1)
        XCTAssertNotNil(try store.syncStamp(.tasks))
    }

    func testTaskInUnsyncedProjectIsSkippedWithoutError() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /tasks", #"[{"id": 1, "project_id": 99, "title": "Orphan"}]"#)
        try await puller.pullAllTasks()
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks"), 0)
    }

    func testDeltaFilterAppliesOnlyWhenWatermarkAndTasksExist() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /tasks", taskBody)
        try await puller.pullAllTasks()
        let first = try XCTUnwrap(server.requests.last?.url?.query)
        XCTAssertFalse(first.contains("filter="), first)

        try await puller.pullAllTasks()
        let query = try XCTUnwrap(server.requests.last?.url?.query)
        XCTAssertTrue(query.contains("filter=updated"), query)

        try runSQL(store, "UPDATE sync_state SET tasks_synced_at = '2026-06-10T01:00:00Z' WHERE id = 1")
        XCTAssertEqual(try puller.tasksDeltaFilter(), "updated > '2026-06-09T10:00:00Z'")
        try runSQL(store, "UPDATE tasks SET deleted = 1")
        XCTAssertNil(try puller.tasksDeltaFilter())
    }

    func testPullTasksForProjectScopesTheFilter() async throws {
        let (puller, _, server) = try makePuller()
        server.json("GET /tasks", "[]")
        try await puller.pullTasks(projectServerId: 1)
        let query = try XCTUnwrap(server.requests.last?.url?.query?.removingPercentEncoding)
        XCTAssertTrue(query.contains("filter=project_id = 1"), query)
    }

    func testPendingLabelToggleSurvivesPull() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /tasks", #"[{"id": 100, "project_id": 1, "title": "T", "labels": []}]"#)
        try await puller.pullAllTasks()
        let task = try XCTUnwrap(try store.tasks(matching: TaskQuery()).first)
        server.json("GET /labels", #"[{"id": 7, "title": "Home"}]"#)
        try await puller.pullLabels()
        let label = try XCTUnwrap(try store.labels().first)
        try store.toggleTaskLabel(taskLocalId: task.localId, labelLocalId: label.localId)
        // The toggle marks nothing on the task row, but the outbox op must be respected.
        try await puller.pullAllTasks()
        XCTAssertEqual(try store.labels(forTask: task.localId).map(\.title), ["Home"])
    }

    func testPullViewsAndBuckets() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /projects/1/views", """
            [{"id": 10, "title": "Board", "project_id": 1, "view_kind": "kanban", "position": 1}]
            """)
        server.json("GET /projects/1/views/10/buckets", """
            [{"id": 20, "title": "Todo", "project_view_id": 10, "position": 1}]
            """)
        let projectLocalId = try XCTUnwrap(try store.syncedProjects().first?.localId)
        try await assertNoBusEvents(store) {
            let count = try await puller.pullViewsAndBuckets(projectLocalId: projectLocalId)
            XCTAssertEqual(count, 1)
        }
        XCTAssertEqual(try store.views(forProject: projectLocalId).count, 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM buckets"), 1)

        try await puller.pullAllViews()
        try await puller.pullAllBuckets()
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM buckets WHERE deleted = 0"), 1)
        XCTAssertNotNil(try store.syncStamp(.views))
        XCTAssertNotNil(try store.syncStamp(.buckets))
    }

    func testSingleFlightCoalescesConcurrentCalls() async throws {
        let (puller, _, server) = try makePuller()
        server.json("GET /labels", #"[{"id": 1, "title": "A"}]"#)
        async let one = puller.pullLabels()
        async let two = puller.pullLabels()
        _ = try await (one, two)
        XCTAssertLessThanOrEqual(server.requests.filter { $0.url?.path.hasSuffix("/labels") == true }.count, 2)
    }
}
