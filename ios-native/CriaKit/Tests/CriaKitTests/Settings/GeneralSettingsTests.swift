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

    func testReadsWeekStartDefaultProjectAndDiscoverability() throws {
        let value = try user("""
        {"settings": {"week_start": 0, "default_project_id": 7,
         "discoverable_by_email": true, "discoverable_by_name": true}}
        """)
        let general = GeneralSettings(user: value)
        XCTAssertEqual(general.weekStart, 0)
        XCTAssertEqual(general.defaultProjectId, 7)
        XCTAssertTrue(general.discoverableByEmail)
        XCTAssertTrue(general.discoverableByName)
    }

    func testWeekStartAndDefaultProjectFallBack() throws {
        let general = GeneralSettings(user: try user(#"{"settings": {"week_start": 9}}"#))
        XCTAssertEqual(general.weekStart, 1)
        XCTAssertEqual(general.defaultProjectId, 0)
    }

    func testNewChangesNameOnlyTheirField() {
        XCTAssertEqual(GeneralSettings.changeWeekStart(0)?.settings, ["week_start": .number(0)])
        XCTAssertNil(GeneralSettings.changeWeekStart(7))
        XCTAssertEqual(GeneralSettings.changeDefaultProject(5)?.settings, ["default_project_id": .number(5)])
        XCTAssertNil(GeneralSettings.changeDefaultProject(-1))
        XCTAssertEqual(GeneralSettings.changeDiscoverableByName(true).settings, ["discoverable_by_name": .bool(true)])
        XCTAssertEqual(GeneralSettings.changeDiscoverableByEmail(false).settings, ["discoverable_by_email": .bool(false)])
    }
}

final class GeneralSettingsLanguageTests: XCTestCase {
    func testReadsLanguageAndTimezone() throws {
        let value = try decodeFixture(JSONValue.self, #"{"id": 1, "settings": {"language": "de", "timezone": "Europe/Berlin"}}"#)
        let general = GeneralSettings(user: value)
        XCTAssertEqual(general.language, "de")
        XCTAssertEqual(general.timezone, "Europe/Berlin")
    }

    func testLanguageAndTimezoneDefaults() throws {
        let general = GeneralSettings(user: try decodeFixture(JSONValue.self, #"{"id": 1}"#))
        XCTAssertEqual(general.language, "en")
        XCTAssertEqual(general.timezone, "UTC")
    }

    func testChangesNameOnlyTheirField() throws {
        XCTAssertEqual(GeneralSettings.changeLanguage("fr")?.settings, ["language": .string("fr")])
        XCTAssertEqual(GeneralSettings.changeTimezone("Europe/London")?.settings, ["timezone": .string("Europe/London")])
    }

    func testInvalidChangesAreRejected() {
        XCTAssertNil(GeneralSettings.changeLanguage(""))
        XCTAssertNil(GeneralSettings.changeTimezone("Not/AZone"))
    }

    func testServerTimezoneSettingFallsBackToDevice() {
        let key = GeneralSettings.timezoneDefaultsKey
        let saved = UserDefaults.standard.string(forKey: key)
        defer { UserDefaults.standard.set(saved, forKey: key) }
        UserDefaults.standard.set("Asia/Tokyo", forKey: key)
        XCTAssertEqual(TimeZone.criaServerSetting.identifier, "Asia/Tokyo")
        UserDefaults.standard.set("Nope/Nope", forKey: key)
        XCTAssertEqual(TimeZone.criaServerSetting, TimeZone.current)
    }
}
