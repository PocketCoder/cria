import XCTest
@testable import CriaKit

/// The default view (Vikunja's Settings > Default view), the Cria-only view sync and the board sort setting.
final class ProjectViewSyncTests: XCTestCase {
    private func defaults() throws -> UserDefaults {
        try XCTUnwrap(UserDefaults(suiteName: "cria.test.viewSync.\(UUID().uuidString)"))
    }

    // MARK: Default view (Vikunja)

    func testDefaultViewOpensTheFirstViewOfThatKindWhenNothingWasChosen() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let views = try store.views(forProject: project)
        XCTAssertEqual(ProjectViewMemory.choose(remembered: nil, among: views, defaultView: "kanban")?.viewKind, .kanban)
        XCTAssertEqual(ProjectViewMemory.choose(remembered: nil, among: views, defaultView: "table")?.viewKind, .table)
        XCTAssertEqual(ProjectViewMemory.choose(remembered: nil, among: views, defaultView: "first")?.localId, views.first?.localId)
    }

    func testARememberedViewBeatsTheDefaultAndAMissingKindFallsBackToFirst() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store)
        let views = try store.views(forProject: project)
        let gantt = try XCTUnwrap(views.first { $0.viewKind == .gantt })
        XCTAssertEqual(ProjectViewMemory.choose(remembered: gantt.localId, among: views, defaultView: "kanban")?.localId, gantt.localId)
        let withoutKanban = views.filter { $0.viewKind != .kanban }
        XCTAssertEqual(
            ProjectViewMemory.choose(remembered: nil, among: withoutKanban, defaultView: "kanban")?.localId, withoutKanban.first?.localId
        )
    }

    func testDefaultViewIsReadAndChangedLikeVikunjaWebDoes() {
        let user: JSONValue = .object(["settings": .object(["frontend_settings": .object(["default_view": .string("gantt")])])])
        XCTAssertEqual(GeneralSettings(user: user).defaultView, "gantt")
        XCTAssertEqual(GeneralSettings(user: .object([:])).defaultView, "first")
        let odd: JSONValue = .object(["settings": .object(["frontend_settings": .object(["default_view": .string("calendar")])])])
        XCTAssertEqual(GeneralSettings(user: odd).defaultView, "first", "an unknown value reads as the default")
        let change = GeneralSettings.changeDefaultView("table")
        XCTAssertEqual(change?.frontend["default_view"]?.stringValue, "table")
        XCTAssertNil(GeneralSettings.changeDefaultView("calendar"))
    }

    // MARK: View sync (Cria-only)

    func testChangeNeedsServerIdsOnBothSides() {
        XCTAssertEqual(ProjectViewSync.change(projectServerId: 5, viewServerId: 12)?.cria["projectView.5"], .number(12))
        XCTAssertNil(ProjectViewSync.change(projectServerId: nil, viewServerId: 12))
        XCTAssertNil(ProjectViewSync.change(projectServerId: 5, viewServerId: nil))
    }

    func testEntriesReadOnlyTheProjectViewKeys() {
        let cria: JSONBody = [
            "projectView.5": .number(12), "projectView.x": .number(3), "projectView.7": .string("nope"), "swipeLeft": .string("star")
        ]
        XCTAssertEqual(ProjectViewSync.entries(in: cria), [5: 12])
    }

    func testSyncedViewsAreCopiedIntoThisDevicesMemory() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store, projectServerId: 1)
        let defaults = try defaults()
        try store.applySyncedProjectViews([1: 13, 99: 1, 1_000: 2], defaults: defaults)
        let table = try XCTUnwrap(try store.views(forProject: project).first { $0.serverId == 13 })
        XCTAssertEqual(ProjectViewMemory.remembered(projectLocalId: project, defaults: defaults), table.localId)
    }

    func testChoosingAViewProducesTheChangeToSend() throws {
        let store = try makeStore()
        let project = try seedSyncedViews(store, projectServerId: 1)
        let kanban = try XCTUnwrap(try store.views(forProject: project).first { $0.viewKind == .kanban })
        let change = try store.syncedProjectViewChange(projectLocalId: project, viewLocalId: kanban.localId)
        XCTAssertEqual(change?.cria["projectView.1"], .number(14))
    }

    // MARK: Settings

    func testProjectSettingsRoundTripAndOnlyTheSortFollowsTheAccount() {
        var prefs = LocalPreferences.default
        prefs.custom.kanbanSortByDue = true
        prefs.custom.syncProjectViews = true
        let codec = PreferencesCodec()
        XCTAssertEqual(codec.decode(codec.encode(prefs)), prefs)

        let change = SyncedPreferences.change(from: .default, to: prefs)
        XCTAssertEqual(change?.cria["kanbanSortByDue"], .bool(true))
        XCTAssertNil(change?.cria["syncProjectViews"], "taking part stays a choice of each device")
        var local = LocalPreferences.default
        local.custom.syncProjectViews = true
        let applied = SyncedPreferences.applying(["kanbanSortByDue": .bool(true), "syncProjectViews": .bool(false)], to: local)
        XCTAssertTrue(applied.custom.kanbanSortByDue)
        XCTAssertTrue(applied.custom.syncProjectViews)
    }
}
