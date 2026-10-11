import XCTest
@testable import CriaKit

final class ReminderScheduleTests: XCTestCase {
    func testPlanBuildsStableIdentifiersAndSkipsBadDates() {
        let planned = ReminderSchedule.plan([
            UpcomingReminder(taskLocalId: "abc", title: "One", reminderAt: "2099-01-01T09:00:00Z"),
            UpcomingReminder(taskLocalId: "def", title: "Bad", reminderAt: "not a date")
        ])
        XCTAssertEqual(planned.map(\.identifier), ["cria.reminder.abc.2099-01-01T09:00:00Z"])
    }

    func testReconcileAddsMissingAndRemovesOnlyStaleCriaEntries() {
        let keep = PlannedReminder(identifier: "cria.reminder.a.1", title: "Keep", fireDate: Date())
        let fresh = PlannedReminder(identifier: "cria.reminder.b.2", title: "New", fireDate: Date())
        let result = ReminderSchedule.reconcile(
            wanted: [keep, fresh],
            pendingIdentifiers: ["cria.reminder.a.1", "cria.reminder.gone.3", "other.app.item"]
        )
        XCTAssertEqual(result.add, [fresh])
        XCTAssertEqual(result.removeIdentifiers, ["cria.reminder.gone.3"])
    }

    func testRepeatLabels() {
        XCTAssertEqual(RepeatLabel.label(repeatAfter: 0, repeatMode: 1), "Monthly")
        XCTAssertEqual(RepeatLabel.label(repeatAfter: 604_800, repeatMode: 0), "Weekly")
        XCTAssertEqual(RepeatLabel.label(repeatAfter: 172_800, repeatMode: 0), "Every 2 days")
        XCTAssertEqual(RepeatLabel.label(repeatAfter: 3600, repeatMode: 0), "Hourly")
        XCTAssertEqual(RepeatLabel.label(repeatAfter: 90, repeatMode: 0), "Every 90s")
        XCTAssertEqual(RepeatLabel.label(repeatAfter: 0, repeatMode: 0), "")
        XCTAssertTrue(RepeatLabel.isRepeating(repeatAfter: 0, repeatMode: 1))
        XCTAssertFalse(RepeatLabel.isRepeating(repeatAfter: 0, repeatMode: 0))
    }
}
