import XCTest
@testable import CriaKit

private func parse(_ json: String) throws -> JSONBody {
    try XCTUnwrap(try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)).objectValue)
}

/// Shaped like GET /user's `settings` on current upstream Vikunja, with keys Cria knows nothing about,
/// which must survive every save untouched.
let serverSettingsJSON = """
{"name": "Jake", "email_reminders_enabled": true, "discoverable_by_name": true, "discoverable_by_email": false,
 "overdue_tasks_reminders_enabled": true, "overdue_tasks_reminders_time": "08:30", "default_project_id": 7,
 "week_start": 0, "language": "de", "timezone": "Europe/London", "extra_settings_links": {},
 "frontend_settings": {"quick_add_magic_mode": "todoist", "color_schema": "dark", "sidebar_width": 320,
   "quick_add_default_reminders": [{"relative_period": -3600}], "some_future_key": {"nested": [1, 2]},
   "cria": {"colorScheme": "light", "dateFormat": "DD/MM/YYYY"}}}
"""

final class FrontendSettingsTests: XCTestCase {
    func testReaders() throws {
        let server = try parse(serverSettingsJSON)
        let frontend = FrontendSettings.frontendSettings(of: server)
        XCTAssertEqual(FrontendSettings.quickAddMagicMode(of: frontend), "todoist")
        XCTAssertEqual(FrontendSettings.criaPrefs(of: frontend)?["colorScheme"], .string("light"))
    }

    func testMissingNullOrNonObjectBlobIsEmpty() {
        XCTAssertEqual(FrontendSettings.frontendSettings(of: nil), [:])
        XCTAssertEqual(FrontendSettings.frontendSettings(of: ["frontend_settings": .null]), [:])
        XCTAssertEqual(FrontendSettings.frontendSettings(of: ["frontend_settings": .string("{\"a\":1}")]), [:])
        XCTAssertEqual(FrontendSettings.frontendSettings(of: ["frontend_settings": .array([.number(1)])]), [:])
    }

    func testOnlyKnownModesAreAccepted() {
        XCTAssertEqual(FrontendSettings.quickAddMagicMode(of: ["quick_add_magic_mode": .string("disabled")]), "disabled")
        XCTAssertNil(FrontendSettings.quickAddMagicMode(of: ["quick_add_magic_mode": .string("Todoist")]))
        XCTAssertNil(FrontendSettings.quickAddMagicMode(of: ["quickAddMagicMode": .string("todoist")]))
        XCTAssertNil(FrontendSettings.quickAddMagicMode(of: [:]))
    }

    func testApplyingChangesOneTopLevelFieldAndPassesEverythingElseThrough() throws {
        let server = try parse(serverSettingsJSON)
        let body = FrontendSettings.applying(SettingsChange(settings: ["week_start": .number(1)]), to: server)
        var expected = server
        expected["week_start"] = .number(1)
        XCTAssertEqual(body, expected)
    }

    func testApplyingSetsOneFrontendKeyAndKeepsTheRest() throws {
        let server = try parse(serverSettingsJSON)
        let body = FrontendSettings.applying(SettingsChange(frontend: ["quick_add_magic_mode": .string("disabled")]), to: server)
        var frontend = FrontendSettings.frontendSettings(of: server)
        frontend["quick_add_magic_mode"] = .string("disabled")
        XCTAssertEqual(body["frontend_settings"], .object(frontend))
        XCTAssertEqual(body.filter { $0.key != "frontend_settings" }, server.filter { $0.key != "frontend_settings" })
    }

    func testApplyingMergesCriaPrefsKeyByKey() throws {
        let server = try parse(serverSettingsJSON)
        let body = FrontendSettings.applying(SettingsChange(cria: ["colorScheme": .string("dark")]), to: server)
        let cria = FrontendSettings.criaPrefs(of: FrontendSettings.frontendSettings(of: body))
        XCTAssertEqual(cria, ["colorScheme": .string("dark"), "dateFormat": .string("DD/MM/YYYY")])
        XCTAssertEqual(FrontendSettings.frontendSettings(of: body)["some_future_key"],
                       FrontendSettings.frontendSettings(of: server)["some_future_key"])
    }

    func testApplyingFillsDefaultsForFieldsAnOlderServerOmits() {
        let body = FrontendSettings.applying(SettingsChange(settings: ["name": .string("A")]), to: ["language": .string("fr")])
        XCTAssertEqual(body["language"], .string("fr"))
        XCTAssertEqual(body["week_start"], .number(1))
        XCTAssertEqual(body["timezone"], .string("UTC"))
        XCTAssertEqual(body["name"], .string("A"))
        XCTAssertNil(body["frontend_settings"])
    }

    func testMergePatchNamesOnlyChangedFieldsAndDropsNulls() {
        let patch = FrontendSettings.mergePatch(SettingsChange(
            settings: ["name": .string("Jacob"), "language": .null],
            frontend: ["color_schema": .null, "sidebar_width": .number(10)],
            cria: ["dateFormat": .null, "colorScheme": .string("dark")]
        ))
        XCTAssertEqual(patch, [
            "name": .string("Jacob"),
            "frontend_settings": .object(["sidebar_width": .number(10), "cria": .object(["colorScheme": .string("dark")])])
        ])
    }

    func testMergePatchOfOnlyNullsIsEmpty() {
        XCTAssertEqual(FrontendSettings.mergePatch(SettingsChange(frontend: ["a": .null], cria: ["b": .null])), [:])
    }

    func testMergePatchDropsNestedNulls() {
        let patch = FrontendSettings.mergePatch(SettingsChange(frontend: ["x": .object(["keep": .number(1), "drop": .null])]))
        XCTAssertEqual(patch, ["frontend_settings": .object(["x": .object(["keep": .number(1)])])])
    }
}
