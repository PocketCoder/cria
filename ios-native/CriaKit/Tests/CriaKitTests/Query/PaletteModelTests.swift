import XCTest
@testable import CriaKit

final class PaletteModelTests: XCTestCase {
    private func entry(_ id: String, _ title: String, _ group: PaletteGroup) -> PaletteEntry {
        PaletteEntry(id: id, title: title, group: group, symbol: "circle")
    }

    func testEmptyQueryListsEverythingInDisplayOrder() {
        let places = [
            entry("c", "New task", .commands), entry("p", "Home", .projects), entry("g", "Today", .goTo)
        ]
        let shown = PaletteModel.shown(places: places, tasks: [], query: "  ")
        XCTAssertEqual(shown.map(\.id), ["g", "p", "c"])
    }

    func testQueryFiltersByTitleIgnoringCaseAndKeepsTasksLast() {
        let places = [entry("g", "Today", .goTo), entry("p", "Todo list", .projects), entry("c", "Settings", .commands)]
        let tasks = [entry("t", "Buy milk", .tasks)]
        let shown = PaletteModel.shown(places: places, tasks: tasks, query: "TOD")
        XCTAssertEqual(shown.map(\.id), ["g", "p", "t"])
    }

    func testSectionsGroupConsecutiveEntries() {
        let entries = [entry("a", "A", .goTo), entry("b", "B", .goTo), entry("c", "C", .tasks)]
        let sections = PaletteModel.sections(entries)
        XCTAssertEqual(sections.map(\.group), [.goTo, .tasks])
        XCTAssertEqual(sections.first?.entries.count, 2)
    }

    func testMoveClampsAtBothEnds() {
        XCTAssertEqual(PaletteModel.move(0, count: 3, by: -1), 0)
        XCTAssertEqual(PaletteModel.move(2, count: 3, by: 1), 2)
        XCTAssertEqual(PaletteModel.move(1, count: 3, by: 1), 2)
        XCTAssertEqual(PaletteModel.move(0, count: 0, by: 1), 0)
    }
}
