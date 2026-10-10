import GRDB
import XCTest
@testable import CriaKit

final class BucketRepositoryTests: XCTestCase {
    // MARK: Server sync

    func testServerBucketsAreUpsertedAndOrdered() throws {
        let store = try makeStore()
        let kanban = try seedKanban(store, projectServerId: 7, viewServerId: 101)
        try syncBuckets(store, viewLocalId: kanban.view, [
            bucketJSON(id: 501, viewId: 101, title: "Done", position: 1),
            bucketJSON(id: 500, viewId: 101, title: "Backlog", position: 0)
        ])
        XCTAssertEqual(try store.buckets(forView: kanban.view).map(\.title), ["Backlog", "Done"])
        XCTAssertEqual(try outboxEntries(store, entity: "bucket").count, 0)

        let renamed = bucketJSON(id: 500, viewId: 101, title: "Todo", position: 0)
        try store.upsertBucketFromServer(try decodeFixture(BucketResponse.self, renamed), rawJSON: renamed)
        XCTAssertEqual(try store.buckets(forView: kanban.view).map(\.title), ["Todo", "Done"])
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM buckets"), 2)
    }

    func testBucketWithUnknownViewThrows() throws {
        let store = try makeStore()
        let json = bucketJSON(id: 1, viewId: 99, title: "Orphan")
        XCTAssertThrowsError(try store.upsertBucketFromServer(try decodeFixture(BucketResponse.self, json), rawJSON: json)) { error in
            XCTAssertEqual(error as? ViewError, .parentNotFound(99))
        }
    }

    func testPullKeepsADirtyUnsyncedBucketWhileReplacingSyncedOnes() throws {
        let store = try makeStore()
        let kanban = try seedKanban(store, projectServerId: 4, viewServerId: 40)
        let local = try store.createBucket(BucketInput(title: "Local", viewLocalId: kanban.view))

        try syncBuckets(store, viewLocalId: kanban.view, [bucketJSON(id: 700, viewId: 40, title: "Server")])

        let buckets = try store.buckets(forView: kanban.view)
        XCTAssertEqual(buckets.map(\.title).sorted(), ["Local", "Server"])
        XCTAssertEqual(buckets.first { $0.localId == local.localId }?.title, "Local")
    }

    func testPullSoftDeletesCleanBucketsTheServerDropped() throws {
        let store = try makeStore()
        let kanban = try seedKanban(store)
        try syncBuckets(store, viewLocalId: kanban.view, [
            bucketJSON(id: 1, viewId: 10, title: "A"),
            bucketJSON(id: 2, viewId: 10, title: "B", position: 1)
        ])
        try syncBuckets(store, viewLocalId: kanban.view, [bucketJSON(id: 2, viewId: 10, title: "B", position: 1)])
        XCTAssertEqual(try store.buckets(forView: kanban.view).map(\.title), ["B"])
    }

    func testDirtyBucketIsNotOverwrittenByServer() throws {
        let store = try makeStore()
        let kanban = try seedKanban(store)
        let local = try seedBucket(store, serverId: 5, viewServerId: 10, title: "Doing")
        try store.updateBucket(localId: local, BucketUpdate(title: "My title"))

        try seedBucket(store, serverId: 5, viewServerId: 10, title: "Server title")

        XCTAssertEqual(try store.bucket(localId: local)?.title, "My title")
        XCTAssertEqual(try store.buckets(forView: kanban.view).count, 1)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM conflicts WHERE entity_type = 'bucket'"), 1)
    }

    func testBucketAssignmentsFromServerResolveLocalIds() throws {
        let store = try makeStore()
        let kanban = try seedKanban(store)
        let bucket = try seedBucket(store, serverId: 100, viewServerId: 10, title: "Todo")
        let task = try seedSyncedTask(store, serverId: 1)

        try store.replaceBucketAssignmentsFromServer(
            viewLocalId: kanban.view, [(taskServerId: 1, bucketServerId: 100), (taskServerId: 99, bucketServerId: 100)]
        )

        let assignments = try store.bucketAssignments(forView: kanban.view)
        XCTAssertEqual(assignments.map(\.taskLocalId), [task])
        XCTAssertEqual(assignments.map(\.bucketLocalId), [bucket])
        XCTAssertEqual(assignments.map(\.viewLocalId), [kanban.view])
        XCTAssertEqual(try outboxEntries(store, entity: "task_bucket").count, 0)
    }

    // MARK: Task placement (kanbanReorder.test.ts)

    private func seedBoard(_ store: CriaStore) throws -> Board {
        let kanban = try seedKanban(store)
        let bucket = try seedBucket(store, serverId: 100, viewServerId: 10, title: "Todo")
        let tasks = try [1, 2, 3].map { try seedSyncedTask(store, serverId: $0, title: "Task \($0)") }
        return Board(view: kanban.view, bucket: bucket, tasks: tasks)
    }

    func testSetTaskBucketStoresPositionOrDefaultsToZero() throws {
        let store = try makeStore()
        let board = try seedBoard(store)
        try store.setTaskBucket(taskLocalId: board.tasks[0], viewLocalId: board.view, bucketLocalId: board.bucket, position: 500)
        try store.setTaskBucket(taskLocalId: board.tasks[1], viewLocalId: board.view, bucketLocalId: board.bucket)

        let positions = Dictionary(
            uniqueKeysWithValues: try store.bucketAssignments(forView: board.view).map { ($0.taskLocalId, $0.position) }
        )
        XCTAssertEqual(positions[board.tasks[0]] ?? nil, 500)
        XCTAssertEqual(positions[board.tasks[1]] ?? nil, 0)
    }

    func testSetTaskBucketReplacesTheAssignmentAndQueuesIt() throws {
        let store = try makeStore()
        let board = try seedBoard(store)
        let other = try seedBucket(store, serverId: 101, viewServerId: 10, title: "Done", position: 1)
        try store.setTaskBucket(taskLocalId: board.tasks[0], viewLocalId: board.view, bucketLocalId: board.bucket)
        try store.setTaskBucket(taskLocalId: board.tasks[0], viewLocalId: board.view, bucketLocalId: other)

        let assignments = try store.bucketAssignments(forView: board.view)
        XCTAssertEqual(assignments.map(\.bucketLocalId), [other])
        let entries = try outboxEntries(store, entity: "task_bucket")
        XCTAssertEqual(entries.map(\.localId), [board.tasks[0], board.tasks[0]])
        let payload = try payloadObject(try XCTUnwrap(entries.last))
        XCTAssertEqual(payload["bucket_local_id"] as? String, other)
        XCTAssertEqual(payload["view_local_id"] as? String, board.view)
    }

    func testUpdateTaskPositionUpdatesRowAndQueuesTaskPosition() throws {
        let store = try makeStore()
        let board = try seedBoard(store)
        try store.setTaskBucket(taskLocalId: board.tasks[0], viewLocalId: board.view, bucketLocalId: board.bucket)

        try store.updateTaskPosition(taskLocalId: board.tasks[0], viewLocalId: board.view, position: 2048)

        XCTAssertEqual(try store.bucketAssignments(forView: board.view).first?.position, 2048)
        let entry = try XCTUnwrap(try outboxEntries(store, entity: "task_position").first)
        XCTAssertEqual(entry.localId, board.tasks[0])
        let payload = try payloadObject(entry)
        XCTAssertEqual(payload["view_local_id"] as? String, board.view)
        XCTAssertEqual(payload["position"] as? Double, 2048)
    }

    func testReorderRepositionsWithEvenSpacing() throws {
        let store = try makeStore()
        let board = try seedBoard(store)
        for task in board.tasks {
            try store.setTaskBucket(taskLocalId: task, viewLocalId: board.view, bucketLocalId: board.bucket)
        }
        let order = [board.tasks[2], board.tasks[0], board.tasks[1]]

        try store.reorderTasksInBucket(viewLocalId: board.view, bucketLocalId: board.bucket, orderedTaskIds: order, baseStep: 2048)

        let assignments = try store.bucketAssignments(forView: board.view)
        XCTAssertEqual(assignments.map(\.taskLocalId), order)
        XCTAssertEqual(assignments.map(\.position), [2048, 4096, 6144])
    }

    func testReorderUpsertsRowsForTasksWithNoPriorAssignment() throws {
        let store = try makeStore()
        let board = try seedBoard(store)
        // Only the first task has an assignment; the others were implicitly in the default bucket.
        try store.setTaskBucket(taskLocalId: board.tasks[0], viewLocalId: board.view, bucketLocalId: board.bucket)
        let order = [board.tasks[2], board.tasks[0], board.tasks[1]]

        try store.reorderTasksInBucket(viewLocalId: board.view, bucketLocalId: board.bucket, orderedTaskIds: order)

        let assignments = try store.bucketAssignments(forView: board.view)
        XCTAssertEqual(assignments.map(\.taskLocalId), order)
        XCTAssertEqual(assignments.map(\.position), [1024, 2048, 3072])
        XCTAssertEqual(try outboxEntries(store, entity: "task_position").count, 3)
    }

    func testAssignmentsAreOrderedByPosition() throws {
        let store = try makeStore()
        let board = try seedBoard(store)
        let positions: [Double] = [3000, 1000, 2000]
        for (task, position) in zip(board.tasks, positions) {
            try store.setTaskBucket(taskLocalId: task, viewLocalId: board.view, bucketLocalId: board.bucket, position: position)
        }
        let ordered = try store.bucketAssignments(forView: board.view).map(\.taskLocalId)
        XCTAssertEqual(ordered, [board.tasks[1], board.tasks[2], board.tasks[0]])
    }

    // MARK: Bucket mutations

    func testCreateBucketAppendsAfterMaxPositionAndQueuesCreate() throws {
        let store = try makeStore()
        let kanban = try seedKanban(store)
        try seedBucket(store, serverId: 1, viewServerId: 10, title: "Todo", position: 100)

        let created = try store.createBucket(BucketInput(title: "Later", viewLocalId: kanban.view, limit: 5))

        XCTAssertEqual(created.position, 1124)
        XCTAssertEqual(created.limit, 5)
        XCTAssertNil(created.serverId)
        let entries = try outboxEntries(store, entity: "bucket")
        XCTAssertEqual(entries.map(\.operation), ["create"])
        XCTAssertEqual(entries.map(\.localId), [created.localId])
        XCTAssertEqual(try payloadObject(try XCTUnwrap(entries.first))["title"] as? String, "Later")
    }

    func testUpdateAndDeleteBucketQueueOps() throws {
        let store = try makeStore()
        try seedKanban(store)
        let local = try seedBucket(store, serverId: 1, viewServerId: 10, title: "Todo")

        let updated = try store.updateBucket(localId: local, BucketUpdate(title: "Doing", limit: 3))
        XCTAssertEqual(updated.title, "Doing")
        XCTAssertEqual(updated.limit, 3)

        try store.deleteBucket(localId: local)
        XCTAssertNil(try store.bucket(localId: local))
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM buckets WHERE local_id = ? AND deleted = 1", [local]), 1)
        XCTAssertEqual(try outboxEntries(store, entity: "bucket").map(\.operation), ["update", "delete"])
    }

    func testUpdateUnknownBucketThrows() throws {
        let store = try makeStore()
        XCTAssertThrowsError(try store.updateBucket(localId: "nope", BucketUpdate(title: "x")))
    }

    func testViewConfigPointsAtDoneBucket() throws {
        let store = try makeStore()
        let kanban = try seedKanban(store, projectServerId: 8, viewServerId: 80)
        try seedBucket(store, serverId: 808, viewServerId: 80, title: "Done")

        try store.updateView(localId: kanban.view, ViewUpdate(doneBucketServerId: .some(808)))

        XCTAssertEqual(try store.view(localId: kanban.view)?.doneBucketServerId, 808)
        let entry = try XCTUnwrap(try outboxEntries(store, entity: "view").first)
        XCTAssertEqual(try payloadObject(entry)["doneBucketServerId"] as? Int, 808)
    }
}

/// A kanban view with one bucket and three synced tasks.
private struct Board {
    let view: String
    let bucket: String
    let tasks: [String]
}
