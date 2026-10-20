import XCTest
@testable import CriaKit

/// The "Expanded quick-add syntax" setting (`frontend_settings.cria.expandedQuickAdd`) and where its dates end up.
final class QuickAddExpandedSettingsTests: XCTestCase {
    func testOffByDefault() {
        XCTAssertFalse(Customisation.default.expandedQuickAdd)
        XCTAssertFalse(Customisation(values: [:]).expandedQuickAdd)
        XCTAssertFalse(LocalPreferences.default.custom.expandedQuickAdd)
    }

    func testRoundTripsThroughThePreferenceCodec() {
        var prefs = LocalPreferences.default
        prefs.custom.expandedQuickAdd = true
        let codec = PreferencesCodec()
        XCTAssertEqual(codec.decode(codec.encode(prefs)).custom.expandedQuickAdd, true)
    }

    func testFollowsTheAccountInTheCriaNamespace() {
        var enabled = LocalPreferences.default
        enabled.custom.expandedQuickAdd = true
        let change = SyncedPreferences.change(from: .default, to: enabled)
        XCTAssertEqual(change?.cria["expandedQuickAdd"], .bool(true))
        XCTAssertEqual(change?.cria.count, 1, "only the changed key is written")
        XCTAssertNil(SyncedPreferences.change(from: enabled, to: enabled))

        let applied = SyncedPreferences.applying(["expandedQuickAdd": .bool(true)], to: .default)
        XCTAssertTrue(applied.custom.expandedQuickAdd)
        let untouched = SyncedPreferences.applying(["detectDates": .bool(false)], to: enabled)
        XCTAssertTrue(untouched.custom.expandedQuickAdd, "a missing key leaves the local value")
        let turnedOff = SyncedPreferences.applying(["expandedQuickAdd": .bool(false)], to: enabled)
        XCTAssertFalse(turnedOff.custom.expandedQuickAdd)
    }

    func testReadsAWrongTypeAsOff() {
        XCTAssertFalse(Customisation(values: ["expandedQuickAdd": .string("yes")]).expandedQuickAdd)
    }

    func testBuildCarriesTheStartAndEndDates() throws {
        let store = try makeStore()
        let home = try seedProject(store, title: "Home")
        let fields = QuickAddFields(
            dueDate: "2030-01-01T09:00:00Z", startDate: "2030-01-01T09:00:00Z", endDate: "2030-01-01T10:00:00Z"
        )
        let input = try XCTUnwrap(buildQuickAddInput(
            title: "x", projectTitle: nil, projects: try store.projects(), selectedProjectId: home, fallbackProjectId: nil, fields: fields
        ))
        XCTAssertEqual(input.startDate, "2030-01-01T09:00:00Z")
        XCTAssertEqual(input.endDate, "2030-01-01T10:00:00Z")
        let bare = try XCTUnwrap(buildQuickAddInput(
            title: "x", projectTitle: nil, projects: try store.projects(), selectedProjectId: home, fallbackProjectId: nil,
            fields: QuickAddFields()
        ))
        XCTAssertNil(bare.startDate)
        XCTAssertNil(bare.endDate)
    }

    func testTheStoreKeepsThemOnTheNewTask() throws {
        let store = try makeStore()
        let home = try seedProject(store, title: "Home")
        var input = TaskInput(title: "Standup", projectLocalId: home, dueDate: "2030-01-01T09:00:00Z")
        input.startDate = "2030-01-01T09:00:00Z"
        input.endDate = "2030-01-01T10:00:00Z"
        input.repeatAfter = 86_400
        input.repeatMode = 2
        let created = try store.persistQuickAdd(input, labelTitles: [])
        XCTAssertEqual(created.startDate, "2030-01-01T09:00:00Z")
        XCTAssertEqual(created.endDate, "2030-01-01T10:00:00Z")
        XCTAssertEqual(created.repeatMode, 2)
        XCTAssertEqual(try store.task(localId: created.localId)?.endDate, "2030-01-01T10:00:00Z")
    }

    func testAPlainTaskHasNoStartOrEnd() throws {
        let store = try makeStore()
        let home = try seedProject(store, title: "Home")
        let created = try store.persistQuickAdd(TaskInput(title: "Plain", projectLocalId: home), labelTitles: [])
        XCTAssertNil(created.startDate)
        XCTAssertNil(created.endDate)
    }
}
