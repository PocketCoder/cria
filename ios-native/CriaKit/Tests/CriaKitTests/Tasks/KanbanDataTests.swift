import XCTest
@testable import CriaKit

final class KanbanDataTests: XCTestCase {
    private struct Board {
        let store: CriaStore
        let view: String
        let todo: String
        let doing: String
    }

    private func makeBoard() throws -> Board {
        let store = try makeStore()
        let kanban = try seedKanban(store, projectServerId: 1, viewServerId: 10)
        let todo = try seedBucket(store, serverId: 500, viewServerId: 10, title: "Todo", position: 0)
        let doing = try seedBucket(store, serverId: 501, viewServerId: 10, title: "Doing", position: 1)
        return Board(store: store, view: kanban.view, todo: todo, doing: doing)
    }

    private func titles(_ column: KanbanColumn?) -> [String] {
        column?.tasks.map(\.title) ?? []
    }

    func testUnplacedTasksFallIntoTheFirstBucket() throws {
        let board = try makeBoard()
        try seedSyncedTask(board.store, serverId: 1, title: "One")
        let columns = try board.store.kanbanColumns(viewLocalId: board.view)
        XCTAssertEqual(columns.map(\.bucket.title), ["Todo", "Doing"])
        XCTAssertEqual(titles(columns.first), ["One"])
        XCTAssertEqual(titles(columns.last), [])
    }

    func testCrossColumnMoveAssignsBucketAndQueuesOps() throws {
        let board = try makeBoard()
        let task = try seedSyncedTask(board.store, serverId: 1, title: "One")
        let columns = try board.store.kanbanColumns(viewLocalId: board.view)
        let result = try board.store.moveCard(
            taskLocalId: task, viewLocalId: board.view, target: columns[1], orderedIds: [task]
        )
        XCTAssertEqual(result, .moved)
        let after = try board.store.kanbanColumns(viewLocalId: board.view)
        XCTAssertEqual(titles(after.last), ["One"])
        XCTAssertEqual(try outboxEntries(board.store, entity: "task_bucket").count, 1)
    }

    func testReorderInsideAColumnWritesAPosition() throws {
        let board = try makeBoard()
        let first = try seedSyncedTask(board.store, serverId: 1, title: "First")
        let second = try seedSyncedTask(board.store, serverId: 2, title: "Second")
        let columns = try board.store.kanbanColumns(viewLocalId: board.view)
        try board.store.moveCard(
            taskLocalId: second, viewLocalId: board.view, target: columns[0], orderedIds: [second, first]
        )
        let after = try board.store.kanbanColumns(viewLocalId: board.view)
        XCTAssertEqual(Set(titles(after.first)), ["First", "Second"])
        XCTAssertEqual(after.first?.tasks.first?.localId, second)
        XCTAssertGreaterThan(try outboxEntries(board.store, entity: "task_position").count, 0)
    }

    func testMidpointMoveOfAnUnassignedCardCreatesItsRow() throws {
        let board = try makeBoard()
        let second = try seedSyncedTask(board.store, serverId: 2, title: "Second")
        let third = try seedSyncedTask(board.store, serverId: 3, title: "Third")
        try board.store.setTaskBucket(taskLocalId: second, viewLocalId: board.view, bucketLocalId: board.todo, position: 1024)
        try board.store.setTaskBucket(taskLocalId: third, viewLocalId: board.view, bucketLocalId: board.todo, position: 2048)
        // Shown in Todo only through the default-bucket fallback: it has no task_buckets row.
        let first = try seedSyncedTask(board.store, serverId: 1, title: "First")
        let before = try board.store.kanbanColumns(viewLocalId: board.view)
        XCTAssertEqual(titles(before.first), ["Second", "Third", "First"])
        try board.store.moveCard(
            taskLocalId: first, viewLocalId: board.view, target: before[0], orderedIds: [second, first, third]
        )
        let after = try board.store.kanbanColumns(viewLocalId: board.view)
        XCTAssertEqual(titles(after.first), ["Second", "First", "Third"])
        XCTAssertEqual(try board.store.bucketAssignments(forView: board.view).count, 3)
    }

    func testFilterModeBoardBuildsReadOnlyColumnsFromFilters() throws {
        let board = try makeBoard()
        let hot = try seedSyncedTask(board.store, serverId: 1, title: "Hot")
        try seedSyncedTask(board.store, serverId: 2, title: "Cold")
        try runSQL(board.store, "UPDATE tasks SET priority = 4 WHERE local_id = ?", [hot])
        let config = """
            [{"title":"Urgent","filter":{"filter":"priority >= 3","filter_include_nulls":false}},
             {"title":"Everything","filter":{"filter":""}}]
            """
        _ = try board.store.updateView(
            localId: board.view, ViewUpdate(bucketConfigurationMode: .filter, bucketConfiguration: .some(config))
        )
        let columns = try board.store.kanbanColumns(viewLocalId: board.view)
        XCTAssertEqual(columns.map(\.bucket.title), ["Urgent", "Everything"])
        XCTAssertEqual(titles(columns[0]), ["Hot"])
        XCTAssertEqual(Set(titles(columns[1])), ["Hot", "Cold"])
        let result = try board.store.moveCard(
            taskLocalId: hot, viewLocalId: board.view, target: columns[1], orderedIds: [hot]
        )
        XCTAssertEqual(result, .readOnly)
        XCTAssertEqual(try outboxEntries(board.store, entity: "task_bucket").count, 0)
    }

    func testDropIntoAFullColumnIsBlocked() throws {
        let board = try makeBoard()
        let task = try seedSyncedTask(board.store, serverId: 1, title: "One")
        _ = try board.store.updateBucket(localId: board.doing, BucketUpdate(limit: 1))
        let columns = try board.store.kanbanColumns(viewLocalId: board.view)
        try board.store.moveCard(taskLocalId: task, viewLocalId: board.view, target: columns[1], orderedIds: [task])
        let other = try seedSyncedTask(board.store, serverId: 2, title: "Two")
        let full = try board.store.kanbanColumns(viewLocalId: board.view)
        XCTAssertTrue(full[1].atLimit)
        let result = try board.store.moveCard(
            taskLocalId: other, viewLocalId: board.view, target: full[1], orderedIds: [other, task]
        )
        XCTAssertEqual(result, .blockedByLimit)
    }

    func testDropOrderMovesACardDownByOne() {
        XCTAssertEqual(Kanban.orderAfterDrop(order: ["a", "b", "c"], moving: "a", onto: "b"), ["b", "a", "c"])
        XCTAssertEqual(Kanban.orderAfterDrop(order: ["a", "b", "c"], moving: "a", onto: "c"), ["b", "c", "a"])
    }

    func testDropOrderMovesACardUpBeforeTheTarget() {
        XCTAssertEqual(Kanban.orderAfterDrop(order: ["a", "b", "c"], moving: "c", onto: "a"), ["c", "a", "b"])
        XCTAssertEqual(Kanban.orderAfterDrop(order: ["a", "b", "c"], moving: "b", onto: "a"), ["b", "a", "c"])
    }

    func testDropOrderFromAnotherColumnGoesBeforeTheTargetOrToTheEnd() {
        XCTAssertEqual(Kanban.orderAfterDrop(order: ["a", "b"], moving: "x", onto: "b"), ["a", "x", "b"])
        XCTAssertEqual(Kanban.orderAfterDrop(order: ["a", "b"], moving: "x", onto: nil), ["a", "b", "x"])
        XCTAssertEqual(Kanban.orderAfterDrop(order: ["a", "b"], moving: "a", onto: nil), ["b", "a"])
    }

    func testParseLimitAndAtLimit() {
        XCTAssertEqual(Kanban.parseLimit("3"), 3)
        XCTAssertEqual(Kanban.parseLimit(""), 0)
        XCTAssertEqual(Kanban.parseLimit("abc"), 0)
        XCTAssertEqual(Kanban.parseLimit("-2"), 0)
        XCTAssertTrue(Kanban.isAtLimit(limit: 2, count: 2))
        XCTAssertFalse(Kanban.isAtLimit(limit: 0, count: 5))
    }
}
