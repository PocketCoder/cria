import GRDB
import XCTest
@testable import CriaKit

final class EntityExecutorTests: XCTestCase {
    private func drain(_ store: CriaStore, _ server: StubServer) async {
        let drainer = OutboxDrainer(api: server.api(), store: store)
        await drainer.registerStandardExecutors()
        await drainer.drain()
    }

    private func body(_ request: URLRequest) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any])
    }

    func testProjectFavouriteUpdateSendsFullBody() async throws {
        let store = try makeStore()
        let local = try seedProject(store, serverId: 4, title: "Work")
        let server = StubServer()
        server.json("POST /projects/4", #"{"id": 4, "title": "Work", "updated": "2026-06-11T10:00:00Z"}"#)
        try store.setProjectFavorite(localId: local, isFavorite: true)
        await drain(store, server)
        let sent = try body(try XCTUnwrap(server.requests.last { $0.httpMethod == "POST" }))
        XCTAssertEqual(sent["title"] as? String, "Work")
        XCTAssertEqual(sent["is_favorite"] as? Bool, true)
        XCTAssertEqual(sent["is_archived"] as? Bool, false)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM projects WHERE dirty = 1"), 0)
    }

    func testProjectDeleteRemovesTasksAndRow() async throws {
        let store = try makeStore()
        let local = try seedProject(store, serverId: 4)
        try seedSyncedTask(store, serverId: 1, projectServerId: 4)
        let server = StubServer()
        server.json("DELETE /projects/4", "{}", status: 404)
        try store.database.writer.write {
            try $0.enqueue(.project, localId: local, operation: .delete, payload: [:], at: isoNow())
        }
        await drain(store, server)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM projects"), 0)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks"), 0)
    }

    func testLabelCreateStoresServerIdWithoutHashInBody() async throws {
        let store = try makeStore()
        let local = UUID().uuidString
        try runSQL(store, """
            INSERT INTO labels (local_id, title, hex_color, updated_at, dirty, deleted)
            VALUES (?, 'Home', '#00ff00', '2026-01-01T00:00:00Z', 1, 0)
            """, [local])
        try store.database.writer.write {
            try $0.enqueue(.label, localId: local, operation: .create, payload: [:], at: isoNow())
        }
        let server = StubServer()
        server.json("PUT /labels", #"{"id": 12, "title": "Home", "updated": "2026-06-11T10:00:00Z"}"#)
        await drain(store, server)
        XCTAssertEqual(try store.labels().first?.serverId, 12)
        XCTAssertEqual(try body(try XCTUnwrap(server.requests.first))["hex_color"] as? String, "00ff00")
    }

    func testViewUpdateNeverSyncedIsDeadLettered() async throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let view = try XCTUnwrap(try store.createDefaultViews(projectLocalId: project).first)
        try store.database.writer.write {
            try $0.enqueue(.view, localId: view.localId, operation: .update, payload: [:], at: isoNow())
        }
        let server = StubServer()
        await drain(store, server)
        XCTAssertEqual(try store.deadLetters().count, 1)
        XCTAssertTrue(server.requests.isEmpty)
    }

    func testViewCreateThenBucketCreateAndTaskMove() async throws {
        let store = try makeStore()
        let project = try seedProject(store, serverId: 1)
        let view = try store.createView(projectLocalId: project, ViewInput(title: "Board", viewKind: .kanban))
        let bucket = try store.createBucket(BucketInput(title: "Todo", viewLocalId: view.localId))
        let task = try seedSyncedTask(store, serverId: 9)
        try store.setTaskBucket(taskLocalId: task, viewLocalId: view.localId, bucketLocalId: bucket.localId)
        let server = StubServer()
        server.json("PUT /projects/1/views", #"{"id": 30, "title": "Board", "project_id": 1, "view_kind": "kanban"}"#)
        server.json("PUT /projects/1/views/30/buckets", #"{"id": 40, "title": "Todo", "project_view_id": 30}"#)
        server.json("POST /projects/1/views/30/buckets/40/tasks", "{}")
        await drain(store, server)
        XCTAssertEqual(try store.outboxRows().count, 0)
        XCTAssertEqual(try store.view(localId: view.localId)?.serverId, 30)
        XCTAssertEqual(try store.bucket(localId: bucket.localId)?.serverId, 40)
        let paths = server.requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }
        XCTAssertEqual(paths, [
            "PUT /api/v1/projects/1/views",
            "PUT /api/v1/projects/1/views/30/buckets",
            "POST /api/v1/projects/1/views/30/buckets/40/tasks"
        ])
        let move = try body(try XCTUnwrap(server.requests.last))
        XCTAssertEqual(move["task_id"] as? Int, 9)
        XCTAssertEqual(move["bucket_id"] as? Int, 40)
    }

    func testTaskPositionPosts() async throws {
        let store = try makeStore()
        let kanban = try seedKanban(store)
        let task = try seedSyncedTask(store, serverId: 9)
        try store.updateTaskPosition(taskLocalId: task, viewLocalId: kanban.view, position: 2048)
        let server = StubServer()
        server.json("POST /tasks/9/position", "{}")
        await drain(store, server)
        let sent = try body(try XCTUnwrap(server.requests.first))
        XCTAssertEqual(sent["position"] as? Double, 2048)
        XCTAssertEqual(sent["project_view_id"] as? Int, 10)
    }

    func testCommentCreateUpdateDelete() async throws {
        let store = try makeStore()
        try seedProject(store)
        let task = try seedSyncedTask(store, serverId: 9)
        let comment = try store.createComment(taskLocalId: task, comment: "<p>hi</p>")
        let server = StubServer()
        server.json("PUT /tasks/9/comments", #"{"id": 70, "comment": "<p>hi</p>"}"#)
        await drain(store, server)
        XCTAssertEqual(try store.comment(localId: comment)?.serverId, 70)

        server.json("POST /tasks/9/comments/70", #"{"id": 70, "comment": "<p>edited</p>", "updated": "2026-06-11T10:00:00Z"}"#)
        try store.updateComment(localId: comment, comment: "<p>edited</p>")
        await drain(store, server)
        XCTAssertEqual(try body(try XCTUnwrap(server.requests.last))["comment"] as? String, "<p>edited</p>")

        server.json("DELETE /tasks/9/comments/70", "{}")
        try store.deleteComment(localId: comment)
        await drain(store, server)
        XCTAssertNil(try store.comment(localId: comment))
        XCTAssertEqual(try store.outboxRows().count, 0)
    }

    func testCommentBlocksUntilTaskHasServerId() async throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Local", projectLocalId: project))
        try runSQL(store, "DELETE FROM outbox")
        _ = try store.createComment(taskLocalId: task.localId, comment: "hi")
        let server = StubServer()
        await drain(store, server)
        XCTAssertTrue(server.requests.isEmpty)
        XCTAssertEqual(try store.outboxHead()?.attempts, 0)
    }
}
