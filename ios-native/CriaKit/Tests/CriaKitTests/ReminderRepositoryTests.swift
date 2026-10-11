import XCTest
@testable import CriaKit

final class ReminderRepositoryTests: XCTestCase {
    func testAddAbsoluteReminderQueuesTaskUpdateAndRemoveClearsIt() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Ring", projectLocalId: project))
        let before = try outboxEntries(store, entity: "task").count

        try store.addReminder(taskLocalId: task.localId, ReminderInput(triggerAt: "2099-01-01T09:00:00Z"))
        let stored = try store.reminders(forTask: task.localId)
        XCTAssertEqual(stored.map(\.reminderAt), ["2099-01-01T09:00:00Z"])
        XCTAssertEqual(try outboxEntries(store, entity: "task").count, before + 1)

        try store.removeReminder(taskLocalId: task.localId, try XCTUnwrap(stored.first))
        XCTAssertEqual(try store.reminders(forTask: task.localId).count, 0)
        XCTAssertEqual(try outboxEntries(store, entity: "task").count, before + 2)
    }

    func testRelativeReminderResolvesFromDueDate() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        var input = TaskInput(title: "Due soon", projectLocalId: project)
        input.dueDate = "2099-03-01T12:00:00Z"
        let task = try store.createTask(input)

        try store.addReminder(taskLocalId: task.localId, ReminderInput(period: -3600, relativeTo: .dueDate))

        let stored = try XCTUnwrap(try store.reminders(forTask: task.localId).first)
        XCTAssertEqual(stored.reminderAt, "2099-03-01T11:00:00Z")
        XCTAssertEqual(stored.relativePeriod, -3600)
        XCTAssertEqual(stored.relativeTo, "due_date")
    }

    func testUpcomingSkipsPastAndDoneTasks() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let open = try store.createTask(TaskInput(title: "Open", projectLocalId: project))
        let finished = try store.createTask(TaskInput(title: "Finished", projectLocalId: project))
        try store.addReminder(taskLocalId: open.localId, ReminderInput(triggerAt: "2099-01-01T09:00:00Z"))
        try store.addReminder(taskLocalId: open.localId, ReminderInput(triggerAt: "2001-01-01T09:00:00Z"))
        try store.addReminder(taskLocalId: finished.localId, ReminderInput(triggerAt: "2099-02-01T09:00:00Z"))
        _ = try store.updateTask(localId: finished.localId, patch: TaskPatch(done: true))

        let upcoming = try store.upcomingReminders(after: Date(timeIntervalSince1970: 1_700_000_000), limit: 10)
        XCTAssertEqual(upcoming.map(\.title), ["Open"])
        XCTAssertEqual(upcoming.map(\.reminderAt), ["2099-01-01T09:00:00Z"])
    }
}
