import XCTest
@testable import CriaKit

final class GeneralSettingsTests: XCTestCase {
    private func user(_ json: String) throws -> JSONValue {
        try decodeFixture(JSONValue.self, json)
    }

    func testReadsSettingsFromUserPayload() throws {
        let value = try user("""
        {"id": 1, "username": "j", "settings": {"name": "Jacob", "email_reminders_enabled": true,
         "overdue_tasks_reminders_enabled": true, "overdue_tasks_reminders_time": "07:30",
         "frontend_settings": {"quick_add_magic_mode": "todoist"}}}
        """)
        let general = GeneralSettings(user: value)
        XCTAssertEqual(general.name, "Jacob")
        XCTAssertTrue(general.emailRemindersEnabled)
        XCTAssertTrue(general.overdueRemindersEnabled)
        XCTAssertEqual(general.overdueRemindersTime, "07:30")
        XCTAssertEqual(general.quickAddMagicMode, "todoist")
    }

    func testDefaultsWhenFieldsAreMissing() throws {
        let general = GeneralSettings(user: try user(#"{"id": 1, "username": "j"}"#))
        XCTAssertEqual(general.name, "")
        XCTAssertFalse(general.emailRemindersEnabled)
        XCTAssertEqual(general.overdueRemindersTime, "09:00")
        XCTAssertEqual(general.quickAddMagicMode, "vikunja")
    }

    func testUnknownQuickAddModeFallsBack() throws {
        let value = try user(#"{"settings": {"frontend_settings": {"quick_add_magic_mode": "bogus"}}}"#)
        XCTAssertEqual(GeneralSettings(user: value).quickAddMagicMode, "vikunja")
    }

    func testChangesNameOnlyTheNamedField() {
        let change = GeneralSettings.changeName("  Jacob ")
        XCTAssertEqual(change.settings, ["name": .string("Jacob")])
        XCTAssertTrue(change.frontend.isEmpty)
    }

    func testReminderChanges() {
        XCTAssertEqual(GeneralSettings.changeEmailReminders(true).settings, ["email_reminders_enabled": .bool(true)])
        XCTAssertEqual(GeneralSettings.changeOverdueReminders(false).settings, ["overdue_tasks_reminders_enabled": .bool(false)])
    }

    func testOverdueTimeValidation() {
        XCTAssertNotNil(GeneralSettings.changeOverdueTime("09:05"))
        XCTAssertNil(GeneralSettings.changeOverdueTime("9:05"))
        XCTAssertNil(GeneralSettings.changeOverdueTime("24:00"))
        XCTAssertNil(GeneralSettings.changeOverdueTime("09:60"))
        XCTAssertNil(GeneralSettings.changeOverdueTime("noon"))
    }

    func testQuickAddModeGoesToFrontendSettings() {
        let change = GeneralSettings.changeQuickAddMode("disabled")
        XCTAssertEqual(change?.frontend, ["quick_add_magic_mode": .string("disabled")])
        XCTAssertTrue(change?.settings.isEmpty ?? false)
        XCTAssertNil(GeneralSettings.changeQuickAddMode("other"))
    }
}
