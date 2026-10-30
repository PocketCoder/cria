import XCTest
@testable import CriaKit

final class ReconcileTests: XCTestCase {
    private func setUpStore() throws -> (Puller, CriaStore, StubServer) {
        let store = try makeStore()
        try seedProject(store, serverId: 1)
        try seedProject(store, serverId: 2, title: "Gone")
        try seedSyncedTask(store, serverId: 10, title: "Kept")
        try seedSyncedTask(store, serverId: 11, title: "Removed")
        try seedSyncedTask(store, serverId: 12, title: "In gone project", projectServerId: 2)
        let server = StubServer()
        return (Puller(api: server.api(), store: store), store, server)
    }

    func testRemovesRowsMissingOnServerAndKeepsTheRest() async throws {
        let (puller, store, server) = try setUpStore()
        server.json("GET /tasks", #"[{"id": 10}]"#)
        server.json("GET /projects", #"[{"id": 1}]"#)
        try await puller.reconcileDeletions()
        let titles = try store.tasks(matching: TaskQuery()).map(\.title)
        XCTAssertEqual(titles, ["Kept"])
        XCTAssertEqual(try store.projects().map(\.title), ["Inbox"])
    }

    func testTaskDeletionCheckRemovesTasksDeletedElsewhere() async throws {
        let (puller, store, server) = try setUpStore()
        server.json("GET /tasks", #"[{"id": 10}]"#)
        try await puller.reconcileTaskDeletions()
        XCTAssertEqual(try store.tasks(matching: TaskQuery()).map(\.title), ["Kept"])
        // Projects are left to the full reconcile.
        XCTAssertEqual(try store.projects().count, 2)
    }

    func testTaskDeletionCheckStoresACappedListButRemovesNothing() async throws {
        let (puller, store, server) = try setUpStore()
        let page = (100..<150).map { taskJSON(id: $0, title: "T\($0)") }.joined(separator: ",")
        // 200 full pages: the page cap, so the list may be incomplete.
        server.json("GET /tasks", "[\(page)]", pages: maxPages)
        let complete = try await puller.reconcileTaskDeletions()
        XCTAssertFalse(complete)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE server_id >= 100"), 50, "stored anyway")
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE server_id = 11"), 1, "nothing removed")
        XCTAssertNil(try store.syncStamp(.tasks), "a capped list does not move the watermark")
    }

    func testTaskDeletionCheckStampsDespiteATaskWithNoProject() async throws {
        let (puller, store, server) = try setUpStore()
        server.json("GET /tasks", "[\(taskJSON(id: 10, title: "Kept")), \(taskJSON(id: 60, projectId: 99, title: "Orphan"))]")
        try await puller.reconcileTaskDeletions()
        XCTAssertNotNil(try store.syncStamp(.tasks), "the full list fetches the skipped task again, so it need not hold")
    }

    func testDirtyRowsSurvive() async throws {
        let (puller, store, server) = try setUpStore()
        try runSQL(store, "UPDATE tasks SET dirty = 1 WHERE server_id = 11")
        try runSQL(store, "UPDATE projects SET dirty = 1 WHERE server_id = 2")
        // Dirty only counts while something is queued: a flag with nothing behind it is healed and the row removed.
        for (table, entity, serverId) in [("tasks", "task", 11), ("projects", "project", 2)] {
            try runSQL(store, """
                INSERT INTO outbox (entity_type, entity_local_id, op, payload, created_at)
                SELECT ?, local_id, 'update', '{}', '2026-01-01T00:00:00Z' FROM \(table) WHERE server_id = ?
                """, [entity, serverId])
        }
        server.json("GET /tasks", "[]")
        // Project 1 stays on the server: deleting it would cascade to its tasks, dirty or not.
        server.json("GET /projects", #"[{"id": 1}]"#)
        try await puller.reconcileDeletions()
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE server_id = 11"), 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM projects WHERE server_id = 2"), 1)
    }

    func testFailedListLeavesEverythingInPlace() async throws {
        let (puller, store, server) = try setUpStore()
        server.json("GET /tasks", "boom", status: 500)
        do {
            try await puller.reconcileDeletions()
            XCTFail("expected throw")
        } catch {}
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks"), 3)
    }

    func testAnnouncesAfterReconcile() async throws {
        let (puller, store, server) = try setUpStore()
        server.json("GET /tasks", "[]")
        server.json("GET /projects", "[]")
        var iterator = store.bus.subscribe().makeAsyncIterator()
        try await puller.reconcileDeletions()
        let first = await iterator.next()
        XCTAssertEqual(first, .tasks)
    }

    func testReconcileFetchesTasksOfArchivedProjectsOnAFreshDevice() async throws {
        let store = try makeStore()
        let server = StubServer()
        let puller = Puller(api: server.api(), store: store)
        server.json("GET /projects", #"[{"id": 3, "title": "Old", "is_archived": true}]"#)
        server.json("GET /tasks", "[]")
        server.json("GET /projects/3/views", [
            viewJSON(id: 31, projectId: 3, kind: "kanban", title: "Kanban", position: 2),
            viewJSON(id: 30, projectId: 3, kind: "list", title: "List", position: 1)
        ].joined(separator: ",").wrapped)
        server.json("GET /projects/3/views/30/tasks", "[\(taskJSON(id: 40, projectId: 3, title: "Shelved"))]")
        try await puller.reconcileDeletions()
        XCTAssertEqual(try store.tasks(matching: TaskQuery()).map(\.title), ["Shelved"])
        // Still there on the next reconcile, now with the view stored.
        try await puller.reconcileDeletions()
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE server_id = 40"), 1)
    }

    func testArchivedProjectTaskListFailureKeepsItsTasks() async throws {
        let (puller, store, server) = try setUpStore()
        try runSQL(store, "UPDATE projects SET is_archived = 1 WHERE server_id = 2")
        server.json("GET /projects", #"[{"id": 1}, {"id": 2, "is_archived": true}]"#)
        server.json("GET /tasks", #"[{"id": 10}]"#)
        server.json("GET /projects/2/views", "boom", status: 500)
        try await puller.reconcileDeletions()
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE server_id = 12"), 1)
    }
}

private extension String {
    var wrapped: String { "[\(self)]" }
}
