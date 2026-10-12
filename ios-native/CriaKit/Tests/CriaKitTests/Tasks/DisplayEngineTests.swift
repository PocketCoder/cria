import XCTest
@testable import CriaKit

final class DisplayEngineTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        calendar.locale = Locale(identifier: "en_GB")
        return calendar
    }

    // Wed 2026-05-27 10:00 UTC.
    private var now: Date { DueDates.parse("2026-05-27T10:00:00Z") ?? Date() }

    private struct Fixture {
        let store: CriaStore
        let home: String
        let work: String
        let urgent: String
        let label: String
    }

    private func seedLabel(_ store: CriaStore, serverId: Int, title: String) throws -> String {
        let json = #"{"id": \#(serverId), "title": "\#(title)"}"#
        return try store.upsertLabelFromServer(try decodeFixture(LabelResponse.self, json), rawJSON: json)
    }

    private func seed() throws -> Fixture {
        let store = try makeStore()
        let home = try seedProject(store, serverId: 1, title: "Home")
        let work = try seedProject(store, serverId: 2, title: "Work")
        let label = try seedLabel(store, serverId: 1, title: "errands")
        let urgent = try store.createTask(TaskInput(title: "Pay rent", projectLocalId: home, dueDate: "2026-05-25T00:00:00Z", priority: 4))
        _ = try store.createTask(TaskInput(title: "buy milk", projectLocalId: home, dueDate: "2026-05-27T00:00:00Z", priority: 1))
        _ = try store.createTask(TaskInput(title: "Report", projectLocalId: work, dueDate: "2026-05-28T00:00:00Z", priority: 3))
        _ = try store.createTask(TaskInput(title: "Later", projectLocalId: work, dueDate: "2026-06-20T00:00:00Z"))
        _ = try store.createTask(TaskInput(title: "Someday", projectLocalId: work))
        try store.toggleTaskLabel(taskLocalId: urgent.localId, labelLocalId: label)
        return Fixture(store: store, home: home, work: work, urgent: urgent.localId, label: label)
    }

    private func titles(_ items: [TaskListItem]) -> [String] { items.map(\.task.title) }

    private func context(_ assignees: [String: Set<Int>] = [:], user: Int? = nil) -> DisplayContext {
        DisplayContext(assigneesByTask: assignees, currentUserId: user, now: now, calendar: calendar)
    }

    private func allItems(_ fixture: Fixture) throws -> [TaskListItem] {
        try fixture.store.attachRowData(try fixture.store.tasks(matching: TaskQuery(includeDone: true)))
    }

    func testSmartSortIsDueDateThenPriorityThenTitleWithNoDateLast() throws {
        let fixture = try seed()
        let sorted = DisplayEngine.sorted(try allItems(fixture), by: .smart)
        XCTAssertEqual(titles(sorted), ["Pay rent", "buy milk", "Report", "Later", "Someday"])
    }

    func testNamedSortsAndDirection() throws {
        let fixture = try seed()
        let items = try allItems(fixture)
        XCTAssertEqual(titles(DisplayEngine.sorted(items, by: DisplaySort(field: .title))).first, "buy milk")
        let byPriority = DisplayEngine.sorted(items, by: DisplaySort(field: .priority, descending: true))
        XCTAssertEqual(titles(byPriority).prefix(2), ["Pay rent", "Report"])
        // No due date sorts last in either direction.
        XCTAssertEqual(titles(DisplayEngine.sorted(items, by: DisplaySort(field: .dueDate, descending: true))).last, "Someday")
    }

    func testSortPutsDoneTasksAfterOpenOnes() throws {
        let fixture = try seed()
        _ = try fixture.store.updateTask(localId: fixture.urgent, patch: TaskPatch(done: true))
        let sorted = DisplayEngine.sorted(try allItems(fixture), by: .smart)
        XCTAssertEqual(titles(sorted).last, "Pay rent")
        XCTAssertEqual(sorted.filter(\.task.done).count, 1)
    }

    func testManualKeepsTheGivenOrder() throws {
        let fixture = try seed()
        let items = try allItems(fixture)
        XCTAssertEqual(titles(DisplayEngine.sorted(items, by: .manual)), titles(items))
    }

    func testPriorityFilter() throws {
        let fixture = try seed()
        var filters = DisplayFilters()
        filters.priorities = [3, 4]
        XCTAssertEqual(Set(titles(DisplayEngine.filtered(try allItems(fixture), filters, context()))), ["Pay rent", "Report"])
    }

    func testDateFilters() throws {
        let fixture = try seed()
        let items = try allItems(fixture)
        func run(_ filter: DisplayDateFilter) -> Set<String> {
            var filters = DisplayFilters()
            filters.dueDate = filter
            return Set(titles(DisplayEngine.filtered(items, filters, context())))
        }
        XCTAssertEqual(run(.overdue), ["Pay rent"])
        XCTAssertEqual(run(.today), ["buy milk"])
        XCTAssertEqual(run(.week), ["buy milk", "Report"])
        XCTAssertEqual(run(.none), ["Someday"])
        XCTAssertEqual(run(.all).count, 5)
    }

    func testDeadlineFilterReadsTheEndDate() throws {
        let fixture = try seed()
        let items = try fixture.store.attachRowData(try fixture.store.tasks(matching: TaskQuery(includeDone: true)))
        let report = try XCTUnwrap(items.first { $0.task.title == "Report" })
        var patch = TaskPatch()
        patch.endDate = "2026-05-29T00:00:00Z"
        _ = try fixture.store.updateTask(localId: report.task.localId, patch: patch)
        var filters = DisplayFilters()
        filters.deadline = .week
        XCTAssertEqual(titles(DisplayEngine.filtered(try allItems(fixture), filters, context())), ["Report"])
        filters.deadline = .none
        XCTAssertEqual(DisplayEngine.filtered(try allItems(fixture), filters, context()).count, 4)
    }

    func testLabelAndProjectFilters() throws {
        let fixture = try seed()
        var filters = DisplayFilters()
        filters.labelIds = [fixture.label]
        XCTAssertEqual(titles(DisplayEngine.filtered(try allItems(fixture), filters, context())), ["Pay rent"])
        filters = DisplayFilters()
        filters.projectIds = [fixture.work]
        XCTAssertEqual(Set(titles(DisplayEngine.filtered(try allItems(fixture), filters, context()))), ["Report", "Later", "Someday"])
    }

    func testAssigneeFilters() throws {
        let fixture = try seed()
        let items = try allItems(fixture)
        let report = try XCTUnwrap(items.first { $0.task.title == "Report" }).task.localId
        let other = try XCTUnwrap(items.first { $0.task.title == "Later" }).task.localId
        let map: [String: Set<Int>] = [report: [7], other: [8]]
        var filters = DisplayFilters()
        filters.assignee = .assignedToMe
        XCTAssertEqual(titles(DisplayEngine.filtered(items, filters, context(map, user: 7))), ["Report"])
        XCTAssertEqual(titles(DisplayEngine.filtered(items, filters, context(map, user: nil))), [])
        filters.assignee = .unassigned
        XCTAssertEqual(DisplayEngine.filtered(items, filters, context(map, user: 7)).count, 3)
    }

    func testShowCompletedAndPipeline() throws {
        let fixture = try seed()
        _ = try fixture.store.updateTask(localId: fixture.urgent, patch: TaskPatch(done: true))
        let items = try allItems(fixture)
        let hidden = DisplayEngine.visible(items, config: DisplayConfig(), showCompleted: false, context: context())
        XCTAssertFalse(titles(hidden).contains("Pay rent"))
        let shown = DisplayEngine.visible(items, config: DisplayConfig(), showCompleted: true, context: context())
        XCTAssertEqual(titles(shown).last, "Pay rent")
    }

    func testGroupByPriorityRunsHighestFirst() throws {
        let fixture = try seed()
        let sections = DisplayEngine.sections(
            try allItems(fixture), config: DisplayConfig(groupBy: .priority), showCompleted: true, context: context()
        )
        XCTAssertEqual(sections.map(\.label), ["Urgent", "High", "Low", "No priority"])
        XCTAssertEqual(titles(sections.last?.items ?? []), ["Later", "Someday"])
    }

    func testGroupByDueDate() throws {
        let fixture = try seed()
        let sections = DisplayEngine.sections(
            try allItems(fixture), config: DisplayConfig(groupBy: .dueDate), showCompleted: true, context: context()
        )
        XCTAssertEqual(sections.map(\.label), ["Overdue", "Today", "Tomorrow", "20 Jun", "No date"])
    }

    func testGroupByProjectIsAlphabetical() throws {
        let fixture = try seed()
        let sections = DisplayEngine.sections(
            try allItems(fixture), config: DisplayConfig(groupBy: .project), showCompleted: true, context: context()
        )
        XCTAssertEqual(sections.map(\.label), ["Home", "Work"])
        XCTAssertEqual(sections.map { $0.items.count }, [2, 3])
    }

    func testGroupByLabelPutsUnlabelledLast() throws {
        let fixture = try seed()
        let sections = DisplayEngine.sections(
            try allItems(fixture), config: DisplayConfig(groupBy: .label), showCompleted: true, context: context()
        )
        XCTAssertEqual(sections.map(\.label), ["errands", "No label"])
        XCTAssertEqual(titles(sections[0].items), ["Pay rent"])
        XCTAssertEqual(sections[1].items.count, 4)
    }

    func testUngroupedIsOneSectionWithNoHeaderAndEmptyListHasNone() throws {
        let fixture = try seed()
        let sections = DisplayEngine.sections(try allItems(fixture), config: DisplayConfig(), showCompleted: true, context: context())
        XCTAssertEqual(sections.count, 1)
        XCTAssertEqual(sections[0].label, "")
        XCTAssertTrue(DisplayEngine.sections([], config: DisplayConfig(), showCompleted: true, context: context()).isEmpty)
    }

    func testRefinedKeepsSectionsAndDropsEmptyOnes() throws {
        let fixture = try seed()
        let items = try allItems(fixture)
        let sections = [
            DisplaySection(key: "overdue", label: "Overdue", items: items.filter { $0.task.title == "Pay rent" }),
            DisplaySection(key: "today", label: "Today", items: items.filter { $0.task.title == "buy milk" })
        ]
        var config = DisplayConfig()
        config.filters.priorities = [4]
        let refined = DisplayEngine.refined(sections, config: config, showCompleted: false, context: context())
        XCTAssertEqual(refined.map(\.key), ["overdue"])
    }
}
