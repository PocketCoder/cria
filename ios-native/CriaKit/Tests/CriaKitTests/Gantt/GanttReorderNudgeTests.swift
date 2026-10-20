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

    /// p (a, b with b1, c), then q.
    private var nested: [GanttNode] {
        [node("p"), node("a", level: 1), node("b", level: 1), node("b1", level: 2), node("c", level: 1), node("q")]
    }

    func testSubtaskReordersWithinItsParent() throws {
        let down = try XCTUnwrap(GanttTree.siblingOrder(afterMoving: "a", rowOffset: 2, in: nested))
        XCTAssertEqual(down.parent, "p")
        XCTAssertEqual(down.order, ["b", "a", "c"])
        let up = try XCTUnwrap(GanttTree.siblingOrder(afterMoving: "c", rowOffset: -3, in: nested))
        XCTAssertEqual(up.order, ["c", "a", "b"])
    }

    func testSubtaskNeverLeavesItsParent() throws {
        let past = try XCTUnwrap(GanttTree.siblingOrder(afterMoving: "a", rowOffset: 99, in: nested))
        XCTAssertEqual(past.parent, "p")
        XCTAssertEqual(past.order, ["b", "c", "a"])
        let above = try XCTUnwrap(GanttTree.siblingOrder(afterMoving: "c", rowOffset: -99, in: nested))
        XCTAssertEqual(above.order, ["c", "a", "b"])
        XCTAssertNil(GanttTree.siblingOrder(afterMoving: "b1", rowOffset: 1, in: nested))
        XCTAssertNil(GanttTree.siblingOrder(afterMoving: "a", rowOffset: 0, in: nested))
        XCTAssertNil(GanttTree.siblingOrder(afterMoving: "missing", rowOffset: 1, in: nested))
    }

    func testRootsStillReorderThroughSiblingOrder() throws {
        let result = try XCTUnwrap(GanttTree.siblingOrder(afterMoving: "p", rowOffset: 99, in: nested))
        XCTAssertNil(result.parent)
        XCTAssertEqual(result.order, ["q", "p"])
    }

    func testSiblingIdsAndParent() {
        XCTAssertEqual(GanttTree.siblingIds(of: "p", in: nested), ["a", "b", "c"])
        XCTAssertEqual(GanttTree.siblingIds(of: "b", in: nested), ["b1"])
        XCTAssertEqual(GanttTree.siblingIds(of: nil, in: nested), ["p", "q"])
        XCTAssertEqual(GanttTree.parentId(of: "b1", in: nested), "b")
        XCTAssertNil(GanttTree.parentId(of: "q", in: nested))
    }

    func testReorderSiblingBlocksCarriesSubtreesInsideParent() {
        let rows = GanttTree.reorderSiblingBlocks(nested, parent: "p", order: ["c", "b", "a"])
        XCTAssertEqual(rows.map(\.taskLocalId), ["p", "c", "b", "b1", "a", "q"])
        let roots = GanttTree.reorderSiblingBlocks(nested, parent: nil, order: ["q", "p"])
        XCTAssertEqual(roots.map(\.taskLocalId), ["q", "p", "a", "b", "b1", "c"])
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
