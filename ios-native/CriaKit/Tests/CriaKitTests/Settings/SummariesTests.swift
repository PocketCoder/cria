import XCTest
@testable import CriaKit

final class SummariesTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        calendar.locale = Locale(identifier: "en_GB")
        return calendar
    }

    /// Wednesday 2026-05-27 10:00 UTC.
    private var now: Date { DueDates.parse("2026-05-27T10:00:00Z") ?? Date() }

    private func task(_ title: String, due: String?, done: Bool = false, doneAt: String? = nil) -> SummaryTask {
        SummaryTask(title: title, dueDate: due, done: done, doneAt: doneAt)
    }

    func testNextFireIsTodayWhenTimeIsStillAhead() throws {
        let fire = try XCTUnwrap(Summaries.nextFire(after: now, time: "18:30", calendar: calendar))
        XCTAssertEqual(DueDates.timedISO(fire), "2026-05-27T18:30:00Z")
    }

    func testNextFireIsTomorrowWhenTimePassedOrEqual() throws {
        let passed = try XCTUnwrap(Summaries.nextFire(after: now, time: "08:00", calendar: calendar))
        XCTAssertEqual(DueDates.timedISO(passed), "2026-05-28T08:00:00Z")
        let equal = try XCTUnwrap(Summaries.nextFire(after: now, time: "10:00", calendar: calendar))
        XCTAssertEqual(DueDates.timedISO(equal), "2026-05-28T10:00:00Z")
    }

    func testNextFireHonoursWeekday() throws {
        // Monday (1) after Wednesday 27 May is Monday 1 June.
        let monday = try XCTUnwrap(Summaries.nextFire(after: now, time: "09:00", weekday: 1, calendar: calendar))
        XCTAssertEqual(DueDates.timedISO(monday), "2026-06-01T09:00:00Z")
        // Sunday (0) is 31 May.
        let sunday = try XCTUnwrap(Summaries.nextFire(after: now, time: "09:00", weekday: 0, calendar: calendar))
        XCTAssertEqual(DueDates.timedISO(sunday), "2026-05-31T09:00:00Z")
    }

    func testMorningWhenNothingIsDue() {
        let message = Summaries.morning([task("Later", due: "2026-06-10T00:00:00Z")], now: now, calendar: calendar)
        XCTAssertEqual(message, SummaryMessage(title: "Good morning", body: "Nothing due today."))
    }

    func testMorningCountsTodayAndOverdueAndNamesFirst() {
        let tasks = [
            task("Old", due: "2026-05-20T00:00:00Z"),
            task("Report", due: "2026-05-27T00:00:00Z"),
            task("Finished", due: "2026-05-27T00:00:00Z", done: true),
            task("No date", due: nil)
        ]
        let message = Summaries.morning(tasks, now: now, calendar: calendar)
        XCTAssertEqual(message.title, "Today")
        XCTAssertEqual(message.body, "1 due today, 1 overdue. Start with: Report")
    }

    func testMorningStartsWithOverdueWhenNothingIsDueToday() {
        let message = Summaries.morning([task("Old", due: "2026-05-20T00:00:00Z")], now: now, calendar: calendar)
        XCTAssertEqual(message.body, "1 overdue. Start with: Old")
    }

    func testWeeklyRoundup() {
        let tasks = [
            task("Done recently", due: nil, done: true, doneAt: "2026-05-25T12:00:00Z"),
            task("Done long ago", due: nil, done: true, doneAt: "2026-04-01T12:00:00Z"),
            task("Soon", due: "2026-05-30T00:00:00Z"),
            task("Today", due: "2026-05-27T00:00:00Z"),
            task("Far", due: "2026-07-01T00:00:00Z"),
            task("Late", due: "2026-05-01T00:00:00Z")
        ]
        let message = Summaries.weekly(tasks, now: now, calendar: calendar)
        XCTAssertEqual(message.title, "Your week")
        XCTAssertEqual(message.body, "1 task done last week, 2 due in the next 7 days, 1 overdue.")
    }

    func testWeeklyPluralisesAndOmitsOverdue() {
        let message = Summaries.weekly([], now: now, calendar: calendar)
        XCTAssertEqual(message.body, "0 tasks done last week, 0 due in the next 7 days.")
    }

    func testPlanIsEmptyWhenNotificationsAreOff() {
        let config = SummaryConfig(notificationsEnabled: false, morningEnabled: true, morningTime: "08:00",
                                   weeklyEnabled: true, weeklyTime: "09:00", weekStart: 1)
        XCTAssertTrue(Summaries.plan(config, tasks: [], now: now, calendar: calendar).isEmpty)
    }

    func testPlanSchedulesOnlyEnabledSummaries() {
        let config = SummaryConfig(notificationsEnabled: true, morningEnabled: false, morningTime: "08:00",
                                   weeklyEnabled: true, weeklyTime: "09:00", weekStart: 1)
        let planned = Summaries.plan(config, tasks: [], now: now, calendar: calendar)
        XCTAssertEqual(planned.map(\.identifier), [Summaries.weeklyIdentifier])
        XCTAssertEqual(planned.first.map { DueDates.timedISO($0.fireDate) }, "2026-06-01T09:00:00Z")
    }

    func testPlanBuildsMorningContentForTheFireDay() {
        let config = SummaryConfig(notificationsEnabled: true, morningEnabled: true, morningTime: "08:00",
                                   weeklyEnabled: false, weeklyTime: "09:00", weekStart: 1)
        // The morning fires 28 May, so a task due that day counts as "today".
        let planned = Summaries.plan(config, tasks: [task("Tomorrow's", due: "2026-05-28T00:00:00Z")], now: now, calendar: calendar)
        XCTAssertEqual(planned.first?.message.body, "1 due today. Start with: Tomorrow's")
    }

    func testInvalidTimeFallsBackToEight() throws {
        let fire = try XCTUnwrap(Summaries.nextFire(after: now, time: "junk", calendar: calendar))
        XCTAssertEqual(DueDates.timedISO(fire), "2026-05-28T08:00:00Z")
    }
}
