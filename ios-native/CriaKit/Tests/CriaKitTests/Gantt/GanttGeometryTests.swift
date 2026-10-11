import XCTest
@testable import CriaKit

final class GanttGeometryTests: XCTestCase {
    private let range = GanttDayRange(today: 100, low: 90, high: 120)

    private func node(_ id: String, _ start: Int?, _ end: Int?, derived: Bool = false, color: String? = nil) -> GanttNode {
        GanttNode(taskLocalId: id, hexColor: color, startDay: start, endDay: end, hasDerivedDates: derived)
    }

    func testNormalizeColor() {
        XCTAssertNil(GanttGeometry.normalizeColor(nil))
        XCTAssertEqual(GanttGeometry.normalizeColor("ff0000"), "#ff0000")
        XCTAssertEqual(GanttGeometry.normalizeColor(" #abc "), "#abc")
        XCTAssertNil(GanttGeometry.normalizeColor("zzz"))
        XCTAssertNil(GanttGeometry.normalizeColor(""))
    }

    func testDayRangeToleratesSwappedDates() throws {
        let now = Double(100 * 86_400 + 5)
        let forward = try XCTUnwrap(GanttGeometry.dayRange(from: "1970-04-01T00:00:00Z", to: "1970-04-11T00:00:00Z", now: now))
        let swapped = try XCTUnwrap(GanttGeometry.dayRange(from: "1970-04-11T00:00:00Z", to: "1970-04-01T00:00:00Z", now: now))
        XCTAssertEqual(forward, swapped)
        XCTAssertEqual(forward.today, 100)
        XCTAssertEqual(forward.totalDays, 11)
        XCTAssertNil(GanttGeometry.dayRange(from: "nope", to: "1970-04-01T00:00:00Z", now: now))
    }

    func testResolveBarDaysFillsPartialAndDatelessBars() {
        XCTAssertEqual(GanttGeometry.resolveBarDays(node("a", 95, 99), range: range), GanttDays(start: 95, end: 99, dateless: false))
        XCTAssertEqual(GanttGeometry.resolveBarDays(node("a", 95, nil), range: range), GanttDays(start: 95, end: 101, dateless: false))
        XCTAssertEqual(GanttGeometry.resolveBarDays(node("a", nil, 99), range: range), GanttDays(start: 93, end: 99, dateless: false))
        XCTAssertEqual(GanttGeometry.resolveBarDays(node("a", nil, nil), range: range), GanttDays(start: 100, end: 106, dateless: true))
        let late = GanttDayRange(today: 500, low: 90, high: 120)
        XCTAssertEqual(GanttGeometry.resolveBarDays(node("a", nil, nil), range: late).start, 120)
    }

    func testApplyDragMovesAndClampsResizes() {
        let move = GanttDrag(taskLocalId: "a", mode: .move, originalStart: 10, originalEnd: 14, deltaDays: 3)
        XCTAssertEqual(GanttGeometry.apply(move), GanttDays(start: 13, end: 17, dateless: false))
        let shrink = GanttDrag(taskLocalId: "a", mode: .resizeStart, originalStart: 10, originalEnd: 14, deltaDays: 9)
        XCTAssertEqual(GanttGeometry.apply(shrink), GanttDays(start: 14, end: 14, dateless: false))
        let grow = GanttDrag(taskLocalId: "a", mode: .resizeEnd, originalStart: 10, originalEnd: 14, deltaDays: -9)
        XCTAssertEqual(GanttGeometry.apply(grow), GanttDays(start: 10, end: 10, dateless: false))
    }

    func testMonthGroupsSplitAtMonthBoundaries() {
        // Day 0 is 1970-01-01. 31 January days then 28 February days.
        let groups = GanttGeometry.monthGroups(low: 0, totalDays: 59, dayWidth: 10)
        XCTAssertEqual(groups.map(\.label), ["January 1970", "February 1970"])
        XCTAssertEqual(groups.map(\.width), [310, 280])
        XCTAssertEqual(groups.map(\.left), [0, 310])
    }

    func testPlacementsClampToChartAndFollowTheDrag() {
        let nodes = [node("a", 92, 94, color: "ff0000"), node("b", nil, nil), node("c", 95, 97, derived: true)]
        let plain = GanttGeometry.placements(visible: nodes, range: range, drag: nil, chartWidth: 10_000)
        XCTAssertEqual(plain[0].left, 2 * GanttMetrics.dayWidth)
        XCTAssertEqual(plain[0].width, 3 * GanttMetrics.dayWidth)
        XCTAssertEqual(plain[0].color, "#ff0000")
        XCTAssertEqual(plain[1].top, GanttMetrics.rowHeight + 8)
        XCTAssertTrue(plain[1].isPlaceholder)
        XCTAssertTrue(plain[2].isPlaceholder)
        XCTAssertEqual(plain[0].label, GanttTree.dayText(92) + " \u{2192} " + GanttTree.dayText(94))
        let drag = GanttDrag(taskLocalId: "a", mode: .move, originalStart: 92, originalEnd: 94, deltaDays: 2)
        let dragged = GanttGeometry.placements(visible: nodes, range: range, drag: drag, chartWidth: 10_000)
        XCTAssertEqual(dragged[0].left, 4 * GanttMetrics.dayWidth)
        let narrow = GanttGeometry.placements(visible: nodes, range: range, drag: nil, chartWidth: 150)
        XCTAssertEqual(narrow[0].width, 150 - 2 * GanttMetrics.dayWidth)
    }
}
