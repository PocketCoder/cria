import XCTest
@testable import CriaKit

final class TableCellsTests: XCTestCase {
    private func task(_ json: String) throws -> TaskRecord {
        let store = try makeStore()
        let project = try seedProject(store)
        try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
        return try XCTUnwrap(store.tasks(matching: TaskQuery(projectLocalId: project)).first)
    }

    func testPriorityNames() {
        XCTAssertNil(TableCells.priorityName(0))
        XCTAssertEqual(TableCells.priorityName(3), "High")
        XCTAssertEqual(TableCells.priorityName(5), "Do now")
        XCTAssertNil(TableCells.priorityName(9))
    }

    func testCellTextIsNilForEmptyCells() throws {
        let record = try task(taskJSON(id: 7, title: "Plain"))
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        XCTAssertEqual(TableCells.text(record, .index, projectTitle: nil, now: now), "#7")
        XCTAssertNil(TableCells.text(record, .dueDate, projectTitle: nil, now: now))
        XCTAssertNil(TableCells.text(record, .priority, projectTitle: nil, now: now))
        XCTAssertNil(TableCells.text(record, .percentDone, projectTitle: nil, now: now))
        XCTAssertNil(TableCells.text(record, .project, projectTitle: "", now: now))
        XCTAssertEqual(TableCells.text(record, .project, projectTitle: "Home", now: now), "Home")
        XCTAssertNil(TableCells.text(record, .title, projectTitle: nil, now: now))
    }

    func testCellTextFormatsDueDates() throws {
        let record = try task(taskJSON(id: 8, title: "Due", dueDate: "2026-10-13T00:00:00Z"))
        let now = DueDates.parse("2026-10-12T09:00:00Z") ?? Date()
        let text = TableCells.text(record, .dueDate, projectTitle: nil, now: now)
        XCTAssertEqual(text, DueDates.label("2026-10-13T00:00:00Z", now: now))
        XCTAssertNotNil(text)
    }

    func testDefaultDirections() {
        XCTAssertEqual(TableSort.defaultDirection(for: .dueDate), .asc)
        XCTAssertEqual(TableSort.defaultDirection(for: .title), .asc)
        XCTAssertEqual(TableSort.defaultDirection(for: .priority), .desc)
        XCTAssertEqual(TableSort.defaultDirection(for: .index), .desc)
    }

    func testSortSummary() {
        XCTAssertNil(TableCells.sortSummary([]))
        XCTAssertEqual(TableCells.sortSummary(TableSort.defaultKeys), "#, highest first")
        XCTAssertEqual(
            TableCells.sortSummary([TableSortKey(column: .dueDate, direction: .asc)]), "Due Date, earliest first"
        )
        XCTAssertEqual(TableCells.sortSummary([TableSortKey(column: .title, direction: .desc)]), "Title, Z to A")
    }
}
