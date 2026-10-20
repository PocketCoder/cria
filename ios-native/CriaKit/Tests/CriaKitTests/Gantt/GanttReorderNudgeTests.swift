import XCTest
@testable import CriaKit

final class GanttReorderNudgeTests: XCTestCase {
    private func node(_ id: String, level: Int = 0) -> GanttNode {
        GanttNode(taskLocalId: id, indentLevel: level, startDay: 1, endDay: 2)
    }

    private var tree: [GanttNode] {
        [node("a"), node("a1", level: 1), node("b"), node("c"), node("c1", level: 1)]
    }

    func testRootMovesDownPastSubtree() {
        XCTAssertEqual(GanttTree.rootOrder(afterMoving: "a", rowOffset: 2, in: tree), ["b", "a", "c"])
    }

    func testRootMovesUpAndClamps() {
        XCTAssertEqual(GanttTree.rootOrder(afterMoving: "c", rowOffset: -99, in: tree), ["c", "a", "b"])
        XCTAssertEqual(GanttTree.rootOrder(afterMoving: "a", rowOffset: 99, in: tree), ["b", "c", "a"])
    }

    func testNoChangeAndNonRootGiveNil() {
        XCTAssertNil(GanttTree.rootOrder(afterMoving: "b", rowOffset: 0, in: tree))
        XCTAssertNil(GanttTree.rootOrder(afterMoving: "a1", rowOffset: 1, in: tree))
        XCTAssertNil(GanttTree.rootOrder(afterMoving: "a", rowOffset: 1, in: tree))
    }

    func testNudgeMovesAndResizesWithoutCrossing() {
        let days = GanttDays(start: 10, end: 12, dateless: false)
        XCTAssertEqual(GanttGeometry.nudge(days, direction: 1, edge: .both)?.start, 11)
        XCTAssertEqual(GanttGeometry.nudge(days, direction: 1, edge: .both)?.end, 13)
        XCTAssertEqual(GanttGeometry.nudge(days, direction: 1, edge: .end)?.end, 13)
        XCTAssertEqual(GanttGeometry.nudge(days, direction: -1, edge: .start)?.start, 9)
        let single = GanttDays(start: 10, end: 10, dateless: false)
        XCTAssertEqual(GanttGeometry.nudge(single, direction: -1, edge: .end)?.end, 10)
        XCTAssertEqual(GanttGeometry.nudge(single, direction: 1, edge: .start)?.start, 10)
    }

    func testNudgeSkipsDatelessAndNoDirection() {
        XCTAssertNil(GanttGeometry.nudge(GanttDays(start: 1, end: 2, dateless: true), direction: 1, edge: .both))
        XCTAssertNil(GanttGeometry.nudge(GanttDays(start: 1, end: 2, dateless: false), direction: 0, edge: .both))
    }
}
