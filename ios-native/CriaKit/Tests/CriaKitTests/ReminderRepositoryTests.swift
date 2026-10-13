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

    // MARK: replaceReminder

    func testReplaceSwapsAFixedReminderInOneTaskUpdate() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Ring", projectLocalId: project))
        try store.addReminder(taskLocalId: task.localId, ReminderInput(triggerAt: "2099-01-01T09:00:00Z"))
        let old = try XCTUnwrap(try store.reminders(forTask: task.localId).first)
        let before = try outboxEntries(store, entity: "task").count

        try store.replaceReminder(taskLocalId: task.localId, old: old, with: ReminderInput(triggerAt: "2099-02-02T10:30:00Z"))

        XCTAssertEqual(try store.reminders(forTask: task.localId).map(\.reminderAt), ["2099-02-02T10:30:00Z"])
        XCTAssertEqual(try outboxEntries(store, entity: "task").count, before + 1)
        XCTAssertEqual(try outboxEntries(store, entity: "task").last?.operation, "update")
    }

    func testReplaceTurnsAFixedReminderRelativeAndBack() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        var input = TaskInput(title: "Due soon", projectLocalId: project)
        input.dueDate = "2099-03-01T12:00:00Z"
        let task = try store.createTask(input)
        try store.addReminder(taskLocalId: task.localId, ReminderInput(triggerAt: "2099-01-01T09:00:00Z"))
        let fixed = try XCTUnwrap(try store.reminders(forTask: task.localId).first)

        try store.replaceReminder(taskLocalId: task.localId, old: fixed, with: ReminderInput(period: -7200, relativeTo: .dueDate))
        let relative = try XCTUnwrap(try store.reminders(forTask: task.localId).first)
        XCTAssertEqual(try store.reminders(forTask: task.localId).count, 1)
        XCTAssertEqual(relative.reminderAt, "2099-03-01T10:00:00Z")
        XCTAssertEqual(relative.relativePeriod, -7200)
        XCTAssertEqual(relative.relativeTo, "due_date")

        try store.replaceReminder(taskLocalId: task.localId, old: relative, with: ReminderInput(triggerAt: "2099-04-04T08:00:00Z"))
        let back = try store.reminders(forTask: task.localId)
        XCTAssertEqual(back, [ReminderRecord(reminderAt: "2099-04-04T08:00:00Z", relativePeriod: nil, relativeTo: nil)])
    }

    func testReplaceRelativeKeepsOtherRemindersAndNeverDuplicates() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        var input = TaskInput(title: "Due soon", projectLocalId: project)
        input.dueDate = "2099-03-01T12:00:00Z"
        let task = try store.createTask(input)
        try store.addReminder(taskLocalId: task.localId, ReminderInput(period: -3600, relativeTo: .dueDate))
        try store.addReminder(taskLocalId: task.localId, ReminderInput(period: -86_400, relativeTo: .dueDate))
        let hour = try XCTUnwrap(try store.reminders(forTask: task.localId).first { $0.relativePeriod == -3600 })

        // Editing the hour reminder into the day one that already exists collapses to one row, not two.
        try store.replaceReminder(taskLocalId: task.localId, old: hour, with: ReminderInput(period: -86_400, relativeTo: .dueDate))
        XCTAssertEqual(try store.reminders(forTask: task.localId).map(\.relativePeriod), [-86_400])

        // Replacing a reminder with itself leaves exactly one.
        let day = try XCTUnwrap(try store.reminders(forTask: task.localId).first)
        try store.replaceReminder(taskLocalId: task.localId, old: day, with: ReminderInput(period: -86_400, relativeTo: .dueDate))
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM task_reminders WHERE task_local_id = ?", [task.localId]), 1)
    }

    func testReplaceResetsTheFiredFlagSoTheEditedReminderCanFire() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Ring", projectLocalId: project))
        try store.addReminder(taskLocalId: task.localId, ReminderInput(triggerAt: "2099-01-01T09:00:00Z"))
        try runSQL(store, "UPDATE task_reminders SET notified = 1 WHERE task_local_id = ?", [task.localId])
        let old = try XCTUnwrap(try store.reminders(forTask: task.localId).first)

        try store.replaceReminder(taskLocalId: task.localId, old: old, with: ReminderInput(triggerAt: "2099-01-02T09:00:00Z"))

        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM task_reminders WHERE notified = 1"), 0)
        let upcoming = try store.upcomingReminders(after: Date(timeIntervalSince1970: 1_700_000_000), limit: 10)
        XCTAssertEqual(upcoming.map(\.reminderAt), ["2099-01-02T09:00:00Z"])
    }

    func testReplaceOfAMissingReminderChangesNothing() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Ring", projectLocalId: project))
        try store.addReminder(taskLocalId: task.localId, ReminderInput(triggerAt: "2099-01-01T09:00:00Z"))
        let before = try outboxEntries(store, entity: "task").count
        let stale = ReminderRecord(reminderAt: "2098-05-05T09:00:00Z", relativePeriod: nil, relativeTo: nil)

        XCTAssertThrowsError(try store.replaceReminder(
            taskLocalId: task.localId, old: stale, with: ReminderInput(triggerAt: "2099-06-06T09:00:00Z")
        ))
        XCTAssertEqual(try store.reminders(forTask: task.localId).map(\.reminderAt), ["2099-01-01T09:00:00Z"])
        XCTAssertEqual(try outboxEntries(store, entity: "task").count, before)
    }
}

final class ReminderPeriodTests: XCTestCase {
    func testOpensWithTheLargestWholeUnit() {
        XCTAssertEqual(ReminderPeriod(seconds: -604_800), ReminderPeriod(amount: 1, unit: .weeks, before: true))
        XCTAssertEqual(ReminderPeriod(seconds: -172_800), ReminderPeriod(amount: 2, unit: .days, before: true))
        XCTAssertEqual(ReminderPeriod(seconds: 7_200), ReminderPeriod(amount: 2, unit: .hours, before: false))
        XCTAssertEqual(ReminderPeriod(seconds: -5_400), ReminderPeriod(amount: 90, unit: .minutes, before: true))
        XCTAssertEqual(ReminderPeriod(seconds: 0), ReminderPeriod(amount: 0, unit: .minutes, before: true))
    }

    func testSecondsRoundTrip() {
        for seconds in [-604_800, -86_400, -3_600, -300, 0, 60, 3_600, 90_000] {
            XCTAssertEqual(ReminderPeriod(seconds: seconds).seconds, seconds)
        }
    }

    func testAmountIsClamped() {
        XCTAssertEqual(ReminderPeriod(amount: 999_999_999, unit: .weeks, before: true).seconds, -100_000 * 604_800)
        XCTAssertEqual(ReminderPeriod(amount: -4, unit: .hours, before: false).seconds, 0)
    }

    func testClearPastRemindersSkipsRepeatingAndDoneTasks() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let open = try store.createTask(TaskInput(title: "Open", projectLocalId: project))
        let repeating = try store.createTask(TaskInput(title: "Weekly", projectLocalId: project))
        var weekly = TaskPatch()
        weekly.repeatAfter = 604_800
        _ = try store.updateTask(localId: repeating.localId, patch: weekly)
        let done = try store.createTask(TaskInput(title: "Done", projectLocalId: project))
        for task in [open, repeating, done] {
            try store.addReminder(taskLocalId: task.localId, ReminderInput(triggerAt: "2026-01-01T09:00:00Z"))
        }
        try store.addReminder(taskLocalId: open.localId, ReminderInput(triggerAt: "2099-01-01T09:00:00Z"))
        _ = try store.updateTask(localId: done.localId, patch: TaskPatch(done: true))
        let before = try outboxEntries(store, entity: "task").count

        let now = try XCTUnwrap(DueDates.parse("2026-06-01T00:00:00Z"))
        XCTAssertEqual(try store.clearPastReminders(now: now), 1)

        XCTAssertEqual(try store.reminders(forTask: open.localId).map(\.reminderAt), ["2099-01-01T09:00:00Z"])
        XCTAssertEqual(try store.reminders(forTask: repeating.localId).count, 1)
        XCTAssertEqual(try store.reminders(forTask: done.localId).count, 1)
        XCTAssertEqual(try outboxEntries(store, entity: "task").count, before + 1)
        XCTAssertEqual(try store.clearPastReminders(now: now), 0, "nothing left to clear")
    }
}
