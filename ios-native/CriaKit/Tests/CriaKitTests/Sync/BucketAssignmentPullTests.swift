import GRDB
import XCTest
@testable import CriaKit

/// A card moved in Vikunja-web (or on another device) moves on this device at the next board pull.
final class BucketAssignmentPullTests: XCTestCase {
    private typealias Reply = StubServer.Reply

    private func setUp(listing: [String]) throws -> (Puller, CriaStore, StubServer, projectLocalId: String) {
        let store = try makeStore()
        try seedProject(store)
        let server = StubServer()
        server.json("GET /projects/1/views", """
            [{"id": 10, "title": "Board", "project_id": 1, "view_kind": "kanban", "position": 1,
              "bucket_configuration_mode": "manual"}]
            """)
        server.json("GET /projects/1/views/10/buckets", """
            [{"id": 20, "title": "To do", "project_view_id": 10, "position": 1},
             {"id": 21, "title": "Done", "project_view_id": 10, "position": 2}]
            """)
        // One listing per column per pull, in board order (the stub ignores the bucket_id filter in the query).
        let pages = ["x-pagination-total-pages": "1"]
        server.route("GET /projects/1/views/10/tasks", replies: listing.map { Reply(body: $0, headers: pages) })
        let projectLocalId = try XCTUnwrap(try store.syncedProjects().first?.localId)
        return (Puller(api: server.api(), store: store), store, server, projectLocalId)
    }

    private func column(_ store: CriaStore, _ taskLocalId: String) throws -> Int? {
        try store.database.writer.read { connection in
            try Int.fetchOne(connection, sql: """
                SELECT b.server_id FROM task_buckets tb JOIN buckets b ON b.local_id = tb.bucket_local_id
                 WHERE tb.task_local_id = ?
                """, arguments: [taskLocalId])
        }
    }

    func testPullPlacesCardsInTheServersColumnsSilently() async throws {
        let (puller, store, server, projectLocalId) = try setUp(listing: [#"[{"id": 100, "position": 3}]"#, #"[{"id": 101}]"#])
        let first = try seedSyncedTask(store, serverId: 100)
        let second = try seedSyncedTask(store, serverId: 101)
        try await assertNoBusEvents(store) {
            _ = try await puller.pullViewsAndBuckets(projectLocalId: projectLocalId)
        }
        XCTAssertEqual(try column(store, first), 20)
        XCTAssertEqual(try column(store, second), 21)
        let queries = server.requests.compactMap { $0.url?.query }.filter { $0.contains("bucket_id") }
        XCTAssertEqual(queries.count, 2, "one listing per column")
    }

    func testAMoveMadeElsewhereArrivesButAQueuedLocalMoveIsKept() async throws {
        let both = #"[{"id": 100}, {"id": 101}]"#
        // Pulls 1 and 2: both cards in To do. Pull 3: someone moved the second card to Done in Vikunja-web.
        let (puller, store, _, projectLocalId) = try setUp(listing: [both, "[]", both, "[]", "[]", #"[{"id": 101}]"#])
        let first = try seedSyncedTask(store, serverId: 100)
        let second = try seedSyncedTask(store, serverId: 101)
        _ = try await puller.pullViewsAndBuckets(projectLocalId: projectLocalId)
        let view = try XCTUnwrap(try store.views(forProject: projectLocalId).first?.localId)
        let doneId = try await store.database.writer.read {
            try String.fetchOne($0, sql: "SELECT local_id FROM buckets WHERE server_id = 21")
        }
        let done = try XCTUnwrap(doneId)
        // This device moves the first card; its push has not run yet.
        try store.setTaskBucket(taskLocalId: first, viewLocalId: view, bucketLocalId: done)
        _ = try await puller.pullViewsAndBuckets(projectLocalId: projectLocalId)
        XCTAssertEqual(try column(store, first), 21, "a queued move is not undone by a pull")
        XCTAssertEqual(try column(store, second), 20)
        _ = try await puller.pullViewsAndBuckets(projectLocalId: projectLocalId)
        XCTAssertEqual(try column(store, second), 21, "a move made elsewhere arrives")
        XCTAssertEqual(try column(store, first), 21)
    }

    func testACardTheServerNoLongerPlacesLosesItsStaleRow() async throws {
        let one = #"[{"id": 100}]"#
        let (puller, store, _, projectLocalId) = try setUp(listing: [one, "[]", one, "[]"])
        let first = try seedSyncedTask(store, serverId: 100)
        let gone = try seedSyncedTask(store, serverId: 102)
        _ = try await puller.pullViewsAndBuckets(projectLocalId: projectLocalId)
        let view = try XCTUnwrap(try store.views(forProject: projectLocalId).first?.localId)
        try await store.database.writer.write { connection in
            try connection.execute(sql: """
                INSERT INTO task_buckets (task_local_id, view_local_id, bucket_local_id, position)
                SELECT ?, ?, local_id, 0 FROM buckets WHERE server_id = 21
                """, arguments: [gone, view])
        }
        _ = try await puller.pullViewsAndBuckets(projectLocalId: projectLocalId)
        XCTAssertEqual(try column(store, first), 20)
        XCTAssertNil(try column(store, gone))
    }
}
