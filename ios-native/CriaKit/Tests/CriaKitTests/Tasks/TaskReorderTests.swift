import XCTest
@testable import CriaKit

final class TaskReorderTests: XCTestCase {
    func testOverrideWinsUntilTheStoredOrderChanges() {
        var order = OptimisticOrder()
        let stored = ["a", "b", "c"]
        XCTAssertEqual(order.resolve(stored), stored)
        order.set(["c", "a", "b"], over: stored)
        XCTAssertEqual(order.resolve(stored), ["c", "a", "b"])
        XCTAssertEqual(order.resolve(["c", "a", "b"]), ["c", "a", "b"])
        XCTAssertEqual(order.resolve(["b", "a", "c"]), ["b", "a", "c"])
    }

    func testReorderIsOnlyEnabledInManualOrderWithoutFilters() {
        XCTAssertTrue(ListReorder.isEnabled(sort: nil, hasFilter: false))
        XCTAssertTrue(ListReorder.isEnabled(sort: SortRule(field: .userDefinedOrder, direction: .asc), hasFilter: false))
        XCTAssertFalse(ListReorder.isEnabled(sort: SortRule(field: .userDefinedOrder, direction: .desc), hasFilter: false))
        XCTAssertFalse(ListReorder.isEnabled(sort: SortRule(field: .title, direction: .asc), hasFilter: false))
        XCTAssertFalse(ListReorder.isEnabled(sort: nil, hasFilter: true))
    }

    private func positionedTasks(_ store: CriaStore) throws -> [String] {
        let project = try seedProject(store)
        let fixtures = [
            taskJSON(id: 1, title: "one", position: 1024),
            taskJSON(id: 2, title: "two", position: 2048),
            taskJSON(id: 3, title: "three", position: 3072)
        ]
        for json in fixtures {
            try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
        }
        return try store.tasks(matching: TaskQuery(projectLocalId: project)).map(\.localId)
    }

    func testMidpointDropWritesOnePositionAndSurvivesTheNextRead() throws {
        let store = try makeStore()
        let ids = try positionedTasks(store)
        try store.applyListReorder(orderedIds: [ids[0], ids[2], ids[1]], movedId: ids[2], viewLocalId: "view")
        let reread = try store.tasks(matching: TaskQuery(includeDone: true))
        XCTAssertEqual(reread.map(\.title), ["one", "three", "two"])
        XCTAssertEqual(reread.first { $0.localId == ids[2] }?.position, 1536)
        XCTAssertEqual(try outboxEntries(store, entity: "task_position").count, 1)
    }

    func testCollidingNeighboursReindexTheWholeList() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        for index in 1...3 {
            let json = taskJSON(id: index, title: "t\(index)", position: 0)
            try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
        }
        let ids = try store.tasks(matching: TaskQuery(projectLocalId: project)).map(\.localId)
        try store.applyListReorder(orderedIds: [ids[2], ids[0], ids[1]], movedId: ids[2], viewLocalId: "view")
        let reread = try store.tasks(matching: TaskQuery(projectLocalId: project))
        XCTAssertEqual(reread.compactMap(\.position), [1024, 2048, 3072])
        XCTAssertEqual(reread.first?.localId, ids[2])
        XCTAssertEqual(try outboxEntries(store, entity: "task_position").count, 3)
    }
}
