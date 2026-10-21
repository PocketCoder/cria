import XCTest
@testable import CriaKit

/// Causes of one device missing what another changed, and the repairs.
final class SyncDivergenceTests: XCTestCase {
    private func makePuller() throws -> (Puller, CriaStore, StubServer) {
        let store = try makeStore()
        try seedProject(store)
        let server = StubServer()
        return (Puller(api: server.api(), store: store), store, server)
    }

    func testWatermarkIsTheNewestServerUpdateNotTheDeviceClock() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /tasks", "[\(taskJSON(id: 1, title: "A")), \(taskJSON(id: 2, title: "B"))]")
        try await puller.pullAllTasks()
        XCTAssertEqual(try store.syncStamp(.tasks), "2026-06-09T10:00:00Z")
    }

    func testEmptyDeltaKeepsTheWatermark() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /tasks", "[\(taskJSON(id: 1, title: "A"))]")
        try await puller.pullAllTasks()
        server.json("GET /tasks", "[]")
        try await puller.pullAllTasks()
        XCTAssertEqual(try store.syncStamp(.tasks), "2026-06-09T10:00:00Z")
    }

    func testWatermarkNeverPassesNow() {
        let json = #"{"id": 1, "project_id": 1, "title": "A", "updated": "2999-01-01T00:00:00Z"}"#
        let future = try? decodeFixture(TaskResponse.self, json)
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(Puller.watermark(for: [future].compactMap { $0 }, now: now), now)
        XCTAssertNil(Puller.watermark(for: []))
    }

    func testDeltaOverlapCoversAnyServerTimezone() throws {
        XCTAssertGreaterThanOrEqual(Puller.deltaOverlap, 14 * 60 * 60)
    }

    func testReconcileStoresTasksTheDeltaMissed() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /projects", #"[{"id": 1, "title": "Inbox"}]"#)
        server.json("GET /tasks", "[\(taskJSON(id: 7, title: "Made on the Mac"))]")
        try await puller.reconcileDeletions()
        XCTAssertEqual(try store.tasks(matching: TaskQuery()).map(\.title), ["Made on the Mac"])
    }

    func testReconcileKeepsTasksOfArchivedProjects() async throws {
        let (puller, store, server) = try makePuller()
        _ = try seedSyncedTask(store, serverId: 5, title: "Archived work")
        try runSQL(store, "UPDATE projects SET is_archived = 1 WHERE server_id = 1")
        server.json("GET /projects", #"[{"id": 1, "title": "Inbox", "is_archived": true}]"#)
        server.json("GET /tasks", "[]")
        try await puller.reconcileDeletions()
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE server_id = 5"), 1)
    }

    func testHealFreesFlagsWithNothingQueuedAndKeepsQueuedOnes() throws {
        let store = try makeStore()
        try seedProject(store)
        let stuck = try seedSyncedTask(store, serverId: 1, title: "Stuck")
        let queued = try seedSyncedTask(store, serverId: 2, title: "Queued")
        try runSQL(store, "UPDATE tasks SET dirty = 1, deleted = 1")
        try enqueueRaw(store, .task, localId: queued, op: .delete)
        let failed = try seedSyncedTask(store, serverId: 3, title: "Failed")
        try runSQL(store, "UPDATE tasks SET dirty = 1 WHERE local_id = ?", [failed])
        try runSQL(store, """
            INSERT INTO outbox_dead_letter (entity_type, entity_local_id, op, payload, attempts, last_error, failed_at)
            VALUES ('task', ?, 'update', '{}', 5, 'boom', '2026-01-01T00:00:00Z')
            """, [failed])
        XCTAssertEqual(try store.healOrphanedSyncFlags(), 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE local_id = ? AND dirty = 1", [failed]), 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE local_id = ? AND dirty = 0 AND deleted = 0", [stuck]), 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE local_id = ? AND dirty = 1", [queued]), 1)
    }

    func testHealKeepsTasksHiddenByAQueuedProjectDelete() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        _ = try seedSyncedTask(store, serverId: 1)
        try runSQL(store, "UPDATE tasks SET deleted = 1")
        try enqueueRaw(store, .project, localId: project, op: .delete)
        XCTAssertEqual(try store.healOrphanedSyncFlags(), 0)
    }

    func testResetSyncStampsMakesTheNextPullFull() async throws {
        let (puller, store, server) = try makePuller()
        server.json("GET /tasks", "[\(taskJSON(id: 1, title: "A"))]")
        try await puller.pullAllTasks()
        try store.resetSyncStamps()
        XCTAssertNil(try puller.tasksDeltaFilter())
    }

    func testReconcileRefreshesViewsAndBucketsAndSparesQueuedRows() async throws {
        let (puller, store, server) = try makePuller()
        let project = try XCTUnwrap(try store.syncedProjects().first?.localId)
        try syncViews(store, projectLocalId: project, [
            viewJSON(id: 10, projectId: 1, kind: "kanban", title: "Board"),
            viewJSON(id: 11, projectId: 1, kind: "list", title: "Old list")
        ])
        let view = try XCTUnwrap(try store.syncedKanbanViews().first?.viewLocalId)
        try syncBuckets(store, viewLocalId: view, [
            bucketJSON(id: 1, viewId: 10, title: "Kept"), bucketJSON(id: 2, viewId: 10, title: "Gone"),
            bucketJSON(id: 3, viewId: 10, title: "Failed edit")
        ])
        let failed = try XCTUnwrap(try store.buckets(forView: view).first { $0.serverId == 3 }?.localId)
        try runSQL(store, """
            INSERT INTO outbox_dead_letter (entity_type, entity_local_id, op, payload, attempts, last_error, failed_at)
            VALUES ('bucket', ?, 'update', '{}', 5, 'boom', '2026-01-01T00:00:00Z')
            """, [failed])
        server.json("GET /projects", #"[{"id": 1, "title": "Inbox"}]"#)
        server.json("GET /tasks", "[]")
        server.json("GET /projects/1/views", "[\(viewJSON(id: 10, projectId: 1, kind: "kanban", title: "Board"))]")
        server.json("GET /projects/1/views/10/buckets", "[\(bucketJSON(id: 1, viewId: 10, title: "Kept renamed"))]")
        try await puller.reconcileDeletions()
        XCTAssertEqual(try store.buckets(forView: view).map(\.title).sorted(), ["Failed edit", "Kept renamed"])
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM project_views WHERE server_id = 11 AND deleted = 1"), 1)
    }
}
