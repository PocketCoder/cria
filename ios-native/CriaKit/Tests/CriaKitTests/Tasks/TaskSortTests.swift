import XCTest
@testable import CriaKit

final class TaskSortTests: XCTestCase {
    private func seed(_ fixtures: [String]) throws -> [TaskRecord] {
        let store = try makeStore()
        let project = try seedProject(store)
        for json in fixtures {
            try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
        }
        return try store.tasks(matching: TaskQuery(projectLocalId: project))
    }

    private var sample: [String] {
        [
            taskJSON(id: 1, title: "beta", position: 30, dueDate: "2026-07-01T00:00:00Z"),
            taskJSON(id: 2, title: "Alpha", position: 10),
            taskJSON(id: 3, title: "gamma", position: nil, dueDate: "2026-06-01T00:00:00Z"),
            taskJSON(id: 4, title: "delta", position: 20, dueDate: "2026-08-01T00:00:00Z")
        ]
    }

    func testOptionsMatchTheDesktopList() {
        XCTAssertEqual(TaskSort.options.count, 17)
        XCTAssertEqual(TaskSort.options.first?.rule, SortRule(field: .userDefinedOrder, direction: .asc))
        XCTAssertEqual(Set(TaskSort.options.map(\.label)).count, 17)
    }

    func testNilRuleKeepsInputOrder() throws {
        let tasks = try seed(sample)
        XCTAssertEqual(TaskSort.sorted(tasks, by: nil).map(\.title), tasks.map(\.title))
    }

    func testManualOrderPutsUnpositionedLast() throws {
        let tasks = try seed(sample)
        let sorted = TaskSort.sorted(tasks, by: SortRule(field: .userDefinedOrder, direction: .asc))
        XCTAssertEqual(sorted.map(\.title), ["Alpha", "delta", "beta", "gamma"])
    }

    func testDueDateKeepsMissingDatesLastInBothDirections() throws {
        let tasks = try seed(sample)
        let asc = TaskSort.sorted(tasks, by: SortRule(field: .dueDate, direction: .asc))
        XCTAssertEqual(asc.map(\.title), ["gamma", "beta", "delta", "Alpha"])
        let desc = TaskSort.sorted(tasks, by: SortRule(field: .dueDate, direction: .desc))
        XCTAssertEqual(desc.map(\.title), ["delta", "beta", "gamma", "Alpha"])
    }

    func testTitleAscendingIgnoresCase() throws {
        let tasks = try seed(sample)
        let asc = TaskSort.sorted(tasks, by: SortRule(field: .title, direction: .asc))
        XCTAssertEqual(asc.map(\.title), ["Alpha", "beta", "delta", "gamma"])
    }

    func testTableCycleWalksNoneDescAscNone() {
        var keys: [TableSortKey] = []
        keys = TableSort.cycle(keys, column: .title, additive: false)
        XCTAssertEqual(keys, [TableSortKey(column: .title, direction: .desc)])
        keys = TableSort.cycle(keys, column: .title, additive: false)
        XCTAssertEqual(keys, [TableSortKey(column: .title, direction: .asc)])
        keys = TableSort.cycle(keys, column: .title, additive: false)
        XCTAssertEqual(keys, [])
    }

    func testTableCycleAdditiveKeepsPriorityOrder() {
        let start = [TableSortKey(column: .title, direction: .desc), TableSortKey(column: .dueDate, direction: .desc)]
        let flipped = TableSort.cycle(start, column: .title, additive: true)
        XCTAssertEqual(flipped.map(\.column), [.title, .dueDate])
        XCTAssertEqual(flipped.first?.direction, .asc)
        let added = TableSort.cycle(start, column: .priority, additive: true)
        XCTAssertEqual(added.map(\.column), [.title, .dueDate, .priority])
        let ascending = [TableSortKey(column: .title, direction: .asc), TableSortKey(column: .dueDate, direction: .desc)]
        let removed = TableSort.cycle(ascending, column: .title, additive: true)
        XCTAssertEqual(removed.map(\.column), [.dueDate])
    }

    func testTableSortSkipsHiddenAndUnsortableColumns() throws {
        let tasks = try seed(sample)
        let keys = [TableSortKey(column: .title, direction: .asc)]
        let hidden = TableSort.sorted(tasks, keys: keys, visible: [.index])
        XCTAssertEqual(hidden.map(\.title), tasks.map(\.title))
        let shown = TableSort.sorted(tasks, keys: keys, visible: [.title])
        XCTAssertEqual(shown.map(\.title), ["Alpha", "beta", "delta", "gamma"])
        let labels = TableSort.sorted(tasks, keys: [TableSortKey(column: .labels, direction: .asc)], visible: [.labels])
        XCTAssertEqual(labels.map(\.title), tasks.map(\.title))
    }

    func testTableIndexDescendingUsesServerId() throws {
        let tasks = try seed(sample)
        let sorted = TableSort.sorted(tasks, keys: TableSort.defaultKeys, visible: TableViewColumn.defaultVisible)
        XCTAssertEqual(sorted.compactMap(\.serverId), [4, 3, 2, 1])
    }
}

final class TableConfigCodecTests: XCTestCase {
    func testColumnsRoundTripInRenderOrder() {
        let text = TableConfigCodec.encodeColumns([.dueDate, .title])
        XCTAssertEqual(text, "title,dueDate")
        XCTAssertEqual(TableConfigCodec.decodeColumns(text), [.title, .dueDate])
    }

    func testEmptyColumnsFallBackToDefaultsAndUnknownNamesDrop() {
        XCTAssertEqual(TableConfigCodec.decodeColumns(""), TableViewColumn.defaultVisible)
        XCTAssertEqual(TableConfigCodec.decodeColumns("title,bogus"), [.title])
    }

    func testSortRoundTripAndDefault() {
        let keys = [TableSortKey(column: .title, direction: .asc), TableSortKey(column: .dueDate, direction: .desc)]
        XCTAssertEqual(TableConfigCodec.decodeSort(TableConfigCodec.encodeSort(keys)), keys)
        XCTAssertEqual(TableConfigCodec.decodeSort(""), TableSort.defaultKeys)
        XCTAssertEqual(TableConfigCodec.decodeSort(TableConfigCodec.encodeSort([])), [])
        XCTAssertEqual(TableConfigCodec.decodeSort("title:up"), [])
    }
}
