import XCTest
@testable import CriaKit

final class BulkAndTodayTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        calendar.locale = Locale(identifier: "en_GB")
        return calendar
    }

    // Wed 2026-05-27 10:00 UTC.
    private var now: Date { DueDates.parse("2026-05-27T10:00:00Z") ?? Date() }

    private func makeTasks(_ store: CriaStore, _ project: String, _ count: Int) throws -> [String] {
        try (0..<count).map { try store.createTask(TaskInput(title: "task \($0)", projectLocalId: project)).localId }
    }

    // MARK: Bulk actions

    func testBulkCompleteWritesEachTaskAndQueuesAnOpPerTask() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let ids = try makeTasks(store, project, 3)
        _ = try store.updateTask(localId: ids[2], patch: TaskPatch(done: true))
        let before = try outboxEntries(store, entity: "task").count

        let result = store.bulkComplete(ids)
        XCTAssertEqual(result, BulkResult(changed: 2, failures: []))
        XCTAssertTrue(try ids.allSatisfy { try XCTUnwrap(store.task(localId: $0)).done })
        XCTAssertEqual(try outboxEntries(store, entity: "task").count, before + 2)
    }

    func testBulkScheduleAndDeferCountFromEachTasksOwnDate() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let first = try store.createTask(TaskInput(title: "a", projectLocalId: project, dueDate: "2026-05-30T00:00:00Z"))
        let second = try store.createTask(TaskInput(title: "b", projectLocalId: project, dueDate: "2026-05-01T00:00:00Z"))

        store.bulkDefer([first.localId, second.localId], preset: .oneDay, now: now, calendar: calendar)
        XCTAssertEqual(try store.task(localId: first.localId)?.dueDate.flatMap { DueDates.dayKey($0, calendar: calendar) }, "2026-05-31")
        // Overdue counts from today.
        XCTAssertEqual(try store.task(localId: second.localId)?.dueDate.flatMap { DueDates.dayKey($0, calendar: calendar) }, "2026-05-28")

        let scheduled = store.bulkSchedule([first.localId, second.localId], dueDate: "2026-07-01T00:00:00Z")
        XCTAssertEqual(scheduled.changed, 2)
        XCTAssertEqual(try store.task(localId: second.localId)?.dueDate, "2026-07-01T00:00:00Z")
    }

    func testBulkPriorityAndMove() throws {
        let store = try makeStore()
        let home = try seedProject(store, serverId: 1, title: "Home")
        let work = try seedProject(store, serverId: 2, title: "Work")
        let ids = try makeTasks(store, home, 2)
        let inWork = try store.createTask(TaskInput(title: "already", projectLocalId: work)).localId

        XCTAssertEqual(store.bulkSetPriority(ids, priority: 5).changed, 2)
        XCTAssertEqual(try store.task(localId: ids[0])?.priority, 5)
        XCTAssertEqual(store.bulkMove(ids + [inWork], toProject: work).changed, 2)
        XCTAssertEqual(try store.task(localId: ids[1])?.projectLocalId, work)
    }

    func testBulkDeleteAndMissingTasks() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let ids = try makeTasks(store, project, 2)
        XCTAssertEqual(store.bulkDelete(ids), BulkResult(changed: 2, failures: []))
        XCTAssertEqual(try store.taskItems(.project(project)), [])
        // A task that is not there is skipped, not counted and not reported.
        XCTAssertEqual(store.bulkComplete(["missing"]), BulkResult())
    }

    // MARK: Today's empty state

    private func seedToday(_ store: CriaStore) throws -> (project: String, doneToday: String) {
        let project = try seedProject(store, title: "Home")
        _ = try store.createTask(TaskInput(title: "tomorrow", projectLocalId: project, dueDate: "2026-05-28T00:00:00Z"))
        _ = try store.createTask(TaskInput(title: "next week", projectLocalId: project, dueDate: "2026-06-03T00:00:00Z"))
        _ = try store.createTask(TaskInput(title: "too far", projectLocalId: project, dueDate: "2026-06-05T00:00:00Z"))
        _ = try store.createTask(TaskInput(title: "far off", projectLocalId: project, dueDate: "2026-07-20T00:00:00Z"))
        _ = try store.createTask(TaskInput(title: "no date low", projectLocalId: project, priority: 1))
        _ = try store.createTask(TaskInput(title: "no date high", projectLocalId: project, priority: 4))
        let done = try store.createTask(TaskInput(title: "finished", projectLocalId: project, dueDate: "2026-05-27T00:00:00Z"))
        _ = try store.updateTask(localId: done.localId, patch: TaskPatch(done: true))
        return (project, done.localId)
    }

    func testTodayEmptyDataListsThePullForwardWeekAndSuggestions() throws {
        let store = try makeStore()
        _ = try seedToday(store)
        let data = try store.todayEmptyData(now: now, calendar: calendar)
        XCTAssertEqual(data.upcoming.map(\.task.title), ["tomorrow", "next week"])
        XCTAssertEqual(data.suggestions.map(\.task.title), ["no date high", "no date low", "far off"])
        XCTAssertEqual(data.doneToday, 1)
    }

    func testSuggestionsAreCappedAtThree() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        for index in 0..<5 { _ = try store.createTask(TaskInput(title: "t\(index)", projectLocalId: project)) }
        XCTAssertEqual(try store.todayEmptyData(now: now, calendar: calendar).suggestions.count, 3)
    }

    func testPulledForwardKeepsATimeOfDay() {
        XCTAssertEqual(
            TodaySuggestions.pulledForward("2026-06-01T00:00:00Z", now: now, calendar: calendar),
            DueDates.allDayISO(for: now, calendar: calendar)
        )
        XCTAssertEqual(
            TodaySuggestions.pulledForward(nil, now: now, calendar: calendar),
            DueDates.allDayISO(for: now, calendar: calendar)
        )
        let timed = TodaySuggestions.pulledForward("2026-06-01T15:30:00Z", now: now, calendar: calendar)
        XCTAssertEqual(DueDates.parse(timed), DueDates.parse("2026-05-27T15:30:00Z"))
    }

    // MARK: Smart views with completed tasks

    func testSmartGroupsIncludingDone() throws {
        let store = try makeStore()
        let project = try seedProject(store, title: "Home")
        let overdueDone = try store.createTask(TaskInput(title: "old done", projectLocalId: project, dueDate: "2026-05-20T00:00:00Z"))
        let todayDone = try store.createTask(TaskInput(title: "today done", projectLocalId: project, dueDate: "2026-05-27T00:00:00Z"))
        _ = try store.createTask(TaskInput(title: "today open", projectLocalId: project, dueDate: "2026-05-27T00:00:00Z"))
        _ = try store.updateTask(localId: overdueDone.localId, patch: TaskPatch(done: true))
        _ = try store.updateTask(localId: todayDone.localId, patch: TaskPatch(done: true))

        let open = try store.smartGroups(.today, includeDone: false, now: now, calendar: calendar)
        XCTAssertEqual(open.flatMap(\.items).map(\.task.title), ["today open"])
        let all = try store.smartGroups(.today, includeDone: true, now: now, calendar: calendar)
        XCTAssertEqual(Set(all.flatMap(\.items).map(\.task.title)), ["today open", "today done"])
        XCTAssertEqual(all.map(\.key), ["today"])
        let upcoming = try store.smartGroups(.upcoming, includeDone: true, now: now, calendar: calendar)
        XCTAssertEqual(Set(upcoming.flatMap(\.items).map(\.task.title)), ["today open", "today done"])
    }

    func testAssigneeMap() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let ids = try makeTasks(store, project, 2)
        try store.addAssignee(taskLocalId: ids[0], userId: 7, username: "sam")
        try store.addAssignee(taskLocalId: ids[0], userId: 8, username: "alex")
        let map = try store.assigneeMap()
        XCTAssertEqual(map[ids[0]], [7, 8])
        XCTAssertNil(map[ids[1]])
    }
}
