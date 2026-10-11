import GRDB
import XCTest
@testable import CriaKit

final class PullBatchTests: XCTestCase {
    private func body(count: Int) -> String {
        let items = (1...count).map { index in
            """
            {"id": \(index), "project_id": 1, "title": "Task \(index)", "updated": "2026-06-09T10:00:00Z",
             "labels": [{"id": 7, "title": "Home"}], "reminders": [{"reminder": "2026-06-10T09:00:00Z"}]}
            """
        }
        return "[" + items.joined(separator: ",") + "]"
    }

    func testPullAcrossSeveralBatchesStoresEverything() async throws {
        let store = try makeStore()
        try seedProject(store)
        let server = StubServer()
        server.json("GET /tasks", body(count: 120))
        let puller = Puller(api: server.api(), store: store)
        let pulled = try await puller.pullAllTasks()
        XCTAssertEqual(pulled, 120)
        let counts = try await store.database.writer.read { connection in
            (try Int.fetchOne(connection, sql: "SELECT COUNT(*) FROM tasks") ?? 0,
             try Int.fetchOne(connection, sql: "SELECT COUNT(*) FROM task_labels") ?? 0)
        }
        XCTAssertEqual(counts.0, 120)
        XCTAssertEqual(counts.1, 120)
        let labels = try await store.database.writer.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM labels") ?? 0 }
        XCTAssertEqual(labels, 1)
    }

    func testBatchedPullStaysSilentAndKeepsDirtyTasks() async throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let dirty = try store.createTask(TaskInput(title: "Mine", projectLocalId: project))
        try runSQL(store, "UPDATE tasks SET server_id = 2, dirty = 1 WHERE local_id = ?", [dirty.localId])
        let server = StubServer()
        server.json("GET /tasks", body(count: 60))
        let puller = Puller(api: server.api(), store: store)
        try await assertNoBusEvents(store) { _ = try await puller.pullAllTasks() }
        let title = try await store.database.writer.read { try String.fetchOne($0, sql: "SELECT title FROM tasks WHERE server_id = 2") }
        XCTAssertEqual(title, "Mine")
        let reminders = try await store.database.writer.read {
            try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM task_reminders WHERE task_local_id = ?", arguments: [dirty.localId]) ?? 0
        }
        XCTAssertEqual(reminders, 0)
    }
}
