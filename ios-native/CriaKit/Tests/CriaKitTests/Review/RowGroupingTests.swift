import XCTest
@testable import CriaKit

/// The Mac table's subtask nesting and Upcoming's folded quiet days.
final class RowGroupingTests: XCTestCase {
    func testSubtasksMoveUnderTheirParentAndKeepTheirOrder() {
        let ids = ["a", "kid2", "b", "parent", "kid1"]
        let children = ["parent": ["kid1", "kid2"], "gone": ["b"]]
        XCTAssertEqual(TableNesting.nested(ids, children: children), ["a", "b", "parent", "kid2", "kid1"])
        let depths = TableNesting.depths(TableNesting.nested(ids, children: children), children: children)
        XCTAssertEqual(depths["kid1"], 1)
        XCTAssertEqual(depths["b"], 0, "a parent that is not in the table leaves the row at the top")
    }

    func testALoopInParentLinksKeepsEveryRow() {
        let ids = ["x", "y", "z"]
        let nested = TableNesting.nested(ids, children: ["x": ["y"], "y": ["x"]])
        XCTAssertEqual(nested.sorted(), ids)
        XCTAssertEqual(nested.count, 3)
    }

    func testQuietDaysFoldAfterTheFirstThree() {
        // A day's label says whether it has tasks: building a task row needs a database row.
        func day(_ key: String, empty: Bool = true) -> DisplaySection {
            DisplaySection(key: key, label: empty ? "empty" : "busy", items: [])
        }
        let sections = [
            day("overdue", empty: false), day("2026-11-20"), day("2026-11-21"), day("2026-11-22"),
            day("2026-11-23"), day("2026-11-24"), day("2026-11-25", empty: false), day("2026-11-26")
        ]
        let folded = QuietDays.fold(sections, isQuiet: { $0.label == "empty" }, dayLabel: { String($0.suffix(2)) })
        XCTAssertEqual(folded.map(\.key), [
            "overdue", "2026-11-20", "2026-11-21", "2026-11-22", "quiet_20261123", "2026-11-25", "2026-11-26"
        ])
        XCTAssertEqual(folded[4].label, "23 – 24")
        XCTAssertTrue(folded[4].items.isEmpty)
        XCTAssertFalse(QuietDays.isDayKey("overdue"))
    }
}
