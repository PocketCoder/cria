import XCTest
@testable import CriaKit

final class QuickAddDefaultsTests: XCTestCase {
    private func frontend(_ json: String) throws -> JSONBody {
        let value = try decodeFixture(JSONValue.self, json)
        return value.objectValue ?? [:]
    }

    func testReadsVikunjaWebKeys() throws {
        let defaults = QuickAddDefaults(frontend: try frontend(
            #"{"default_due_time": "17:30", "quick_add_default_reminders": [{"relative_period": -3600}, {"relative_period": 0}]}"#
        ))
        XCTAssertEqual(defaults.dueTime, DefaultDueTime(hour: 17, minute: 30))
        XCTAssertEqual(defaults.reminderPeriods, [-3600, 0])
        XCTAssertEqual(defaults.reminders, [.beforeDue(seconds: 3600), .beforeDue(seconds: 0)])
    }

    func testMissingOrMalformedValuesReadAsNone() throws {
        XCTAssertEqual(QuickAddDefaults(frontend: [:]), QuickAddDefaults())
        let bad = QuickAddDefaults(frontend: try frontend(
            #"{"default_due_time": "25:99", "quick_add_default_reminders": [{"relative_period": "x"}, {}, 5]}"#
        ))
        XCTAssertNil(bad.dueTime)
        XCTAssertEqual(bad.reminderPeriods, [])
        XCTAssertNil(DefaultDueTime(text: ""))
        XCTAssertNil(DefaultDueTime(text: "9:30"))
    }

    func testTimeWritesAsHHmmAndClearsWithEmptyString() {
        XCTAssertEqual(
            QuickAddDefaults.changeDueTime(DefaultDueTime(hour: 9, minute: 5)).frontend,
            ["default_due_time": .string("09:05")]
        )
        XCTAssertEqual(QuickAddDefaults.changeDueTime(nil).frontend, ["default_due_time": .string("")])
    }

    func testRemindersWriteTheWholeListAsRelativePeriods() {
        let change = QuickAddDefaults.changeReminders([-3600, 0])
        XCTAssertEqual(change.frontend, [
            "quick_add_default_reminders": .array([
                .object(["relative_period": .number(-3600)]), .object(["relative_period": .number(0)])
            ])
        ])
        // An emptied list is kept in the merge-patch (only nulls are dropped), so it clears the server's.
        let patch = FrontendSettings.mergePatch(QuickAddDefaults.changeReminders([]))
        XCTAssertEqual(patch["frontend_settings"]?["quick_add_default_reminders"], .array([]))
    }

    func testMergePatchNamesOnlyTheChangedKey() {
        let patch = FrontendSettings.mergePatch(QuickAddDefaults.changeDueTime(DefaultDueTime(hour: 8, minute: 0)))
        XCTAssertEqual(patch, ["frontend_settings": .object(["default_due_time": .string("08:00")])])
    }

    func testDefaultTimeGoesOnAnAllDayDateOnly() {
        let time = DefaultDueTime(hour: 14, minute: 30)
        XCTAssertEqual(time?.applying(to: "2026-05-28T00:00:00Z", calendar: utcCalendar), "2026-05-28T14:30:00Z")
        XCTAssertEqual(time?.applying(to: "2026-05-28T09:00:00Z", calendar: utcCalendar), "2026-05-28T09:00:00Z")
    }

    func testParserGivesATypedDateTheDefaultTime() {
        let time = DefaultDueTime(hour: 14, minute: 30)
        let day = parseQuickAdd("Buy milk tomorrow", now: quickAddNow, calendar: utcCalendar, defaultDueTime: time)
        XCTAssertEqual(utcParts(day.dueDate)?.day, 28)
        XCTAssertEqual(utcParts(day.dueDate)?.hour, 14)
        XCTAssertEqual(utcParts(day.dueDate)?.minute, 30)
        let timed = parseQuickAdd("Buy milk tomorrow at 5pm", now: quickAddNow, calendar: utcCalendar, defaultDueTime: time)
        XCTAssertEqual(utcParts(timed.dueDate)?.hour, 17)
        let plain = parseQuickAdd("Buy milk tomorrow", now: quickAddNow, calendar: utcCalendar)
        XCTAssertFalse(DueDates.hasTimeOfDay(plain.dueDate))
    }

    func testLegacyMacReminderMigratesOnlyWhenTheServerHasNoList() throws {
        XCTAssertEqual(QuickAddDefaults.migratedReminders(frontend: [:], legacySecondsBefore: 3600), [-3600])
        XCTAssertEqual(QuickAddDefaults.migratedReminders(frontend: [:], legacySecondsBefore: 0), [0])
        XCTAssertNil(QuickAddDefaults.migratedReminders(frontend: [:], legacySecondsBefore: -1))
        XCTAssertNil(QuickAddDefaults.migratedReminders(frontend: [:], legacySecondsBefore: nil))
        let held = try frontend(#"{"quick_add_default_reminders": []}"#)
        XCTAssertNil(QuickAddDefaults.migratedReminders(frontend: held, legacySecondsBefore: 3600))
    }

    func testTitles() {
        XCTAssertEqual(QuickAddDefaults.title(forPeriod: 0), "At due time")
        XCTAssertEqual(QuickAddDefaults.title(forPeriod: -3600), "1 hour before")
        XCTAssertEqual(QuickAddDefaults.title(forPeriod: -172_800), "2 days before")
        XCTAssertEqual(QuickAddDefaults.title(forPeriod: -604_800), "1 week before")
        XCTAssertEqual(QuickAddDefaults.title(forPeriod: 1_800), "30 minutes after")
        XCTAssertEqual(QuickAddDefaults.options(including: [-7_200]).first, 0)
        XCTAssertTrue(QuickAddDefaults.options(including: [-7_200]).contains(-7_200))
    }

    func testGeneralSettingsCarriesTheDefaultsAndUndoesThem() throws {
        let value = try decodeFixture(
            JSONValue.self, #"{"settings": {"frontend_settings": {"default_due_time": "10:00"}}}"#
        )
        let previous = GeneralSettings(user: value)
        XCTAssertEqual(previous.quickAddDefaults.dueTime, DefaultDueTime(hour: 10, minute: 0))
        var applied = previous
        applied.quickAddDefaults.dueTime = nil
        XCTAssertEqual(applied.undoing(applied: applied, previous: previous).quickAddDefaults, previous.quickAddDefaults)
    }
}
