import XCTest
@testable import CriaKit

final class BoardAndGanttFilterTests: XCTestCase {
    private func tasks() throws -> [TaskRecord] {
        let store = try makeStore()
        let project = try seedProject(store)
        let milk = try store.createTask(TaskInput(title: "Buy Milk", projectLocalId: project, description: "from the shop", priority: 1))
        let report = try store.createTask(TaskInput(title: "Write report", projectLocalId: project, priority: 4))
        let old = try store.createTask(TaskInput(title: "Old thing", projectLocalId: project, priority: 5))
        let done = try store.updateTask(localId: old.localId, patch: TaskPatch(done: true))
        return [milk, report, done]
    }

    func testEmptyFilterIsInactiveAndShowsEverything() throws {
        let all = try tasks()
        XCTAssertFalse(BoardFilter.empty.isActive)
        XCTAssertEqual(BoardFilter.empty.apply(to: all, labels: [:]).count, 3)
        XCTAssertEqual(BoardFilter.empty.stored, "")
    }

    func testTextMatchesTitleAndDescriptionWithoutCase() throws {
        let all = try tasks()
        XCTAssertEqual(BoardFilter(text: "milk").apply(to: all, labels: [:]).map(\.title), ["Buy Milk"])
        XCTAssertEqual(BoardFilter(text: "SHOP").apply(to: all, labels: [:]).map(\.title), ["Buy Milk"])
        XCTAssertTrue(BoardFilter(text: "nothing here").apply(to: all, labels: [:]).isEmpty)
    }

    func testMinimumPriorityAndShowDone() throws {
        let all = try tasks()
        XCTAssertEqual(Set(BoardFilter(minPriority: 4).apply(to: all, labels: [:]).map(\.title)), ["Write report", "Old thing"])
        XCTAssertEqual(Set(BoardFilter(minPriority: 4, showDone: false).apply(to: all, labels: [:]).map(\.title)), ["Write report"])
    }

    func testLabelsMatchAnyOfTheChosen() throws {
        let all = try tasks()
        let labels = [all[0].localId: ["home"], all[1].localId: ["work", "urgent"]]
        let filter = BoardFilter(labelLocalIds: ["urgent", "garden"])
        XCTAssertEqual(filter.apply(to: all, labels: labels).map(\.title), ["Write report"])
    }

    func testStoredTextRoundTripsAndToleratesJunk() {
        let filter = BoardFilter(text: "a", minPriority: 2, labelLocalIds: ["x"], showDone: false)
        XCTAssertEqual(BoardFilter.from(stored: filter.stored), filter)
        XCTAssertEqual(BoardFilter.from(stored: "garbage"), .empty)
        XCTAssertEqual(BoardFilter.from(stored: ""), .empty)
        XCTAssertEqual(BoardFilter.from(stored: #"{"text":"x"}"#), BoardFilter.empty.with(text: "x"))
    }

    // MARK: Gantt

    private func node(_ id: String, _ start: Int?, _ end: Int?) -> GanttNode {
        GanttNode(taskLocalId: id, startDay: start, endDay: end)
    }

    func testStandardGanttFiltersAreInactive() {
        XCTAssertFalse(GanttFilters.standard.isActive)
        XCTAssertEqual(GanttFilters.standard.stored, "")
        XCTAssertTrue(GanttFilters(showUndated: false).isActive)
    }

    func testRangeUsesChosenBoundsAndOrdersSwappedOnes() {
        let automatic = GanttDayRange(today: 100, low: 90, high: 140)
        XCTAssertEqual(GanttFilters.standard.range(automatic: automatic), automatic)
        let fixed = GanttFilters(fromDay: 120, toDay: 110).range(automatic: automatic)
        XCTAssertEqual(fixed, GanttDayRange(today: 100, low: 110, high: 120))
        let halfOpen = GanttFilters(fromDay: 95).range(automatic: automatic)
        XCTAssertEqual(halfOpen, GanttDayRange(today: 100, low: 95, high: 140))
    }

    func testVisibleDropsBarsWhollyOutsideTheRange() {
        let range = GanttDayRange(today: 100, low: 100, high: 110)
        let nodes = [node("in", 102, 105), node("before", 80, 90), node("after", 120, 130), node("edge", 95, 100),
                     node("open", 105, nil), node("none", nil, nil)]
        let filters = GanttFilters(fromDay: 100, toDay: 110)
        XCTAssertEqual(filters.visible(nodes, in: range).map(\.taskLocalId), ["in", "edge", "open", "none"])
        XCTAssertEqual(GanttFilters.standard.visible(nodes, in: range).count, nodes.count)
    }

    func testPickerDatesRoundTripInAnyZone() {
        for zone in ["UTC", "America/Los_Angeles", "Pacific/Auckland"] {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: zone) ?? .gmt
            for day in [0, 20_000, 20_800] {
                let date = GanttFilters.date(forDay: day, calendar: calendar)
                XCTAssertEqual(GanttFilters.day(for: date, calendar: calendar), day, zone)
                XCTAssertEqual(calendar.startOfDay(for: date), date, zone)
            }
        }
    }

    func testGanttStoredRoundTrip() {
        let filters = GanttFilters(fromDay: 5, toDay: 9, showUndated: false)
        XCTAssertEqual(GanttFilters.from(stored: filters.stored), filters)
        XCTAssertEqual(GanttFilters.from(stored: "nope"), .standard)
    }
}

private extension BoardFilter {
    func with(text: String) -> BoardFilter {
        var copy = self
        copy.text = text
        return copy
    }
}
