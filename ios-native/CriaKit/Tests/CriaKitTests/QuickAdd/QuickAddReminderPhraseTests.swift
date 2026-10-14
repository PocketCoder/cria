import XCTest
@testable import CriaKit

/// "remind …" phrases in quick add, the day reminder time, and adding several tasks at once.
final class QuickAddReminderPhraseTests: XCTestCase {
    override func tearDown() {
        CriaRules.current = .standard
        super.tearDown()
    }

    private func london() throws -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Europe/London"))
        return calendar
    }

    func testPhrasesParseAndLeaveTheTitle() {
        let parsed = parseQuickAddTask("Bins friday remind day before at 8pm")
        XCTAssertEqual(parsed.title, "Bins")
        XCTAssertNotNil(parsed.dueDate, "friday is still the due date")
        XCTAssertEqual(parsed.reminders, [.daysBeforeDue(days: 1, minute: 20 * 60)])

        XCTAssertEqual(parseQuickAddTask("Pay rent remind me the day before").reminders, [.daysBeforeDue(days: 1, minute: nil)])
        XCTAssertEqual(parseQuickAddTask("Call remind 2 hours before").reminders, [.beforeDue(seconds: 7_200)])
        XCTAssertEqual(parseQuickAddTask("Trip remind 1 week before 9:30am").reminders, [.daysBeforeDue(days: 7, minute: 570)])
        XCTAssertEqual(parseQuickAddTask("Stretch remind at 5pm").reminders, [.atTimeOfDay(minute: 17 * 60)])
        XCTAssertEqual(parseQuickAddTask("Remind Sam about the bins").reminders, [], "not a reminder phrase")
        XCTAssertEqual(parseQuickAddTask("Bins remind at 25").reminders, [])
        XCTAssertEqual(parseQuickAddTask("Bins remind day before", detectDates: false).reminders, [])
    }

    func testDayBeforeFiresAtTheChosenTimeOnThatDay() throws {
        let calendar = try london()
        let friday = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 10, day: 16)))
        let allDay = DueDates.allDayISO(for: friday, calendar: calendar)
        let rules = CriaRules(nextWeekWeekday: nil, weekendWeekday: 7, resetsSubtasksOnRepeat: false, dayReminderMinute: 9 * 60)

        let dayBefore = QuickAddReminder.daysBeforeDue(days: 1, minute: nil)
        let input = try XCTUnwrap(dayBefore.input(dueDate: allDay, calendar: calendar, rules: rules))
        XCTAssertEqual(input.relativeTo, .dueDate)
        XCTAssertEqual(input.period, -15 * 3_600, "Thursday 09:00 is 15 hours before the start of Friday")

        let timed = try XCTUnwrap(calendar.date(bySettingHour: 17, minute: 0, second: 0, of: friday))
        let evening = try XCTUnwrap(QuickAddReminder.daysBeforeDue(days: 1, minute: 20 * 60)
            .input(dueDate: DueDates.timedISO(timed), calendar: calendar, rules: rules))
        XCTAssertEqual(evening.period, -21 * 3_600, "Thursday 20:00 is 21 hours before Friday 17:00")

        XCTAssertNil(QuickAddReminder.daysBeforeDue(days: 1, minute: nil).input(dueDate: nil, calendar: calendar))
    }

    func testTimeOfDayWithoutADueDateIsTheNextTimeTheClockShowsIt() throws {
        let calendar = try london()
        let now = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 10, day: 14, hour: 18)))
        let input = try XCTUnwrap(QuickAddReminder.atTimeOfDay(minute: 17 * 60).input(dueDate: nil, now: now, calendar: calendar))
        let fires = try XCTUnwrap(input.triggerAt.flatMap { DueDates.parse($0) })
        XCTAssertEqual(calendar.component(.day, from: fires), 15, "5pm has passed today, so tomorrow")
        XCTAssertEqual(calendar.component(.hour, from: fires), 17)
    }

    func testDayBasedReminderReadsAsADayAndATime() throws {
        let calendar = try london()
        let thursday = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 9)))
        XCTAssertEqual(
            ReminderText.dayBased(period: -15 * 3_600, anchor: "due_date", fires: thursday, calendar: calendar),
            "1 day before due date at \(DueDates.timeLabel(thursday, calendar: calendar))"
        )
        XCTAssertNil(ReminderText.dayBased(period: -3_600, anchor: "due_date", fires: thursday, calendar: calendar))
        XCTAssertNil(ReminderText.dayBased(period: -86_400, anchor: "due_date", fires: thursday, calendar: calendar))
    }

    func testDayReminderTimeSyncsAndFeedsTheRules() {
        var prefs = LocalPreferences.default
        prefs.custom.dayReminderMinute = 8 * 60
        XCTAssertEqual(SyncedPreferences.change(from: .default, to: prefs)?.cria["dayReminderMinute"], .number(480))
        XCTAssertEqual(prefs.custom.rules.dayReminderMinute, 480)
        XCTAssertEqual(Customisation(values: ["dayReminderMinute": .number(5_000)]).dayReminderMinute, 540, "out of range")
    }

    func testBatchLinksSubtasksToTheTaskAboveInItsProject() throws {
        let store = try makeStore()
        let home = try seedProject(store)
        let work = try seedProject(store, serverId: 2, title: "Work")
        let items = [
            QuickAddBatchItem(input: TaskInput(title: "Pack", projectLocalId: home)),
            QuickAddBatchItem(input: TaskInput(title: "Socks", projectLocalId: work), isSubtask: true),
            QuickAddBatchItem(input: TaskInput(title: "Charger", projectLocalId: home), isSubtask: true),
            QuickAddBatchItem(input: TaskInput(title: "Book taxi", projectLocalId: work))
        ]
        let created = try store.persistQuickAddBatch(items)

        XCTAssertEqual(created.map(\.title), ["Pack", "Socks", "Charger", "Book taxi"])
        XCTAssertEqual(created.map(\.projectLocalId), [home, home, home, work])
        let subtasks = try store.relations(forTask: created[0].localId).filter { $0.kind == "subtask" }
        XCTAssertEqual(Set(subtasks.map(\.otherTitle)), ["Socks", "Charger"])
        XCTAssertTrue(try store.relations(forTask: created[3].localId).isEmpty)
    }

    func testFirstQueuedSubtaskIsAPlainTask() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let alone = QuickAddBatchItem(input: TaskInput(title: "Alone", projectLocalId: project), isSubtask: true)
        let created = try store.persistQuickAddBatch([alone])
        XCTAssertTrue(try store.relations(forTask: created[0].localId).isEmpty)
    }
}
