import XCTest
@testable import CriaKit

final class SmartViewsTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        calendar.locale = Locale(identifier: "en_GB")
        return calendar
    }

    // Wed 2026-05-27 10:00 UTC.
    private var now: Date { DueDates.parse("2026-05-27T10:00:00Z") ?? Date() }

    private func seed(_ store: CriaStore) throws -> String {
        let project = try seedProject(store, title: "Home")
        let dates = [
            ("overdue", "2026-05-25T00:00:00Z"), ("today", "2026-05-27T00:00:00Z"), ("today late", "2026-05-27T18:00:00Z"),
            ("tomorrow", "2026-05-28T00:00:00Z"), ("later", "2026-06-10T00:00:00Z")
        ]
        for (title, due) in dates {
            _ = try store.createTask(TaskInput(title: title, projectLocalId: project, dueDate: due))
        }
        let done = try store.createTask(TaskInput(title: "finished", projectLocalId: project, dueDate: "2026-05-27T00:00:00Z"))
        _ = try store.updateTask(localId: done.localId, patch: TaskPatch(done: true))
        _ = try store.createTask(TaskInput(title: "undated", projectLocalId: project))
        return project
    }

    private func titles(_ groups: [TaskGroup]) -> [String: [String]] {
        Dictionary(uniqueKeysWithValues: groups.map { ($0.key, $0.items.map(\.task.title)) })
    }

    func testTodayShowsOverdueFirstThenToday() throws {
        let store = try makeStore()
        _ = try seed(store)
        let groups = try store.smartGroups(.today, now: now, calendar: calendar)
        XCTAssertEqual(groups.map(\.key), ["overdue", "today"])
        XCTAssertEqual(titles(groups)["overdue"], ["overdue"])
        XCTAssertEqual(Set(titles(groups)["today"] ?? []), ["today", "today late"])
    }

    func testTodayAlwaysHasATodayGroup() throws {
        let store = try makeStore()
        XCTAssertEqual(try store.smartGroups(.today, now: now, calendar: calendar).map(\.key), ["today"])
    }

    func testUpcomingGroupsByDayFromToday() throws {
        let store = try makeStore()
        _ = try seed(store)
        let groups = try store.smartGroups(.upcoming, now: now, calendar: calendar)
        XCTAssertEqual(groups.map(\.key), ["2026-05-27", "2026-05-28", "2026-06-10"])
        XCTAssertEqual(groups.map(\.label), ["Today", "Tomorrow", "10 Jun"])
        XCTAssertEqual(titles(groups)["2026-05-28"], ["tomorrow"])
    }

    func testInboxIsTheDefaultProject() throws {
        let store = try makeStore()
        let inbox = try seedProject(store, serverId: 7, title: "Inbox")
        let other = try seedProject(store, serverId: 8, title: "Other")
        _ = try store.createTask(TaskInput(title: "in inbox", projectLocalId: inbox))
        _ = try store.createTask(TaskInput(title: "elsewhere", projectLocalId: other))

        let groups = try store.smartGroups(.inbox(defaultProjectServerId: 7), now: now, calendar: calendar)
        XCTAssertEqual(titles(groups), ["inbox": ["in inbox"]])
        XCTAssertEqual(try store.smartGroups(.inbox(defaultProjectServerId: nil)), [])
        XCTAssertEqual(try store.smartGroups(.inbox(defaultProjectServerId: 99)), [])
    }

    private func saveFilter(_ store: CriaStore, id: Int, query: String, includeNulls: Bool = false) throws {
        try store.upsertSavedFilterFromServer(SavedFilterResponse(
            id: id, title: "Mine",
            filters: SavedFilterResponseFilters(filter: query, filterIncludeNulls: includeNulls)
        ))
    }

    func testSavedFilterRunsAcrossProjectsAndHidesDoneUnlessAsked() throws {
        let store = try makeStore()
        let first = try seedProject(store, serverId: 1, title: "One")
        let second = try seedProject(store, serverId: 2, title: "Two")
        let high = try store.createTask(TaskInput(title: "high one", projectLocalId: first, priority: 4))
        _ = try store.createTask(TaskInput(title: "high two", projectLocalId: second, priority: 5))
        _ = try store.createTask(TaskInput(title: "low", projectLocalId: first, priority: 1))
        try saveFilter(store, id: 5, query: "priority >= 4")

        var groups = try store.smartGroups(.savedFilter(serverId: 5), now: now, calendar: calendar)
        XCTAssertEqual(Set(groups.flatMap { $0.items.map(\.task.title) }), ["high one", "high two"])

        _ = try store.updateTask(localId: high.localId, patch: TaskPatch(done: true))
        groups = try store.smartGroups(.savedFilter(serverId: 5), now: now, calendar: calendar)
        XCTAssertEqual(groups.flatMap { $0.items.map(\.task.title) }, ["high two"])

        try saveFilter(store, id: 6, query: "done = true && priority >= 4")
        groups = try store.smartGroups(.savedFilter(serverId: 6), now: now, calendar: calendar)
        XCTAssertEqual(groups.flatMap { $0.items.map(\.task.title) }, ["high one"])
    }

    func testMissingSavedFilterShowsNothing() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        _ = try store.createTask(TaskInput(title: "visible", projectLocalId: project))
        XCTAssertEqual(try store.smartGroups(.savedFilter(serverId: 42), now: now, calendar: calendar), [])
    }

    func testBadFilterThrows() throws {
        let store = try makeStore()
        try saveFilter(store, id: 9, query: "priority >=")
        XCTAssertThrowsError(try store.smartGroups(.savedFilter(serverId: 9), now: now, calendar: calendar))
    }
}
