import XCTest
@testable import CriaKit

final class WidgetListsTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-06-09T10:00:00Z") ?? Date()

    private func isolatedDefaults() throws -> UserDefaults {
        try XCTUnwrap(UserDefaults(suiteName: "cria.test.\(UUID().uuidString)"))
    }

    func testSourceIdsRoundTrip() {
        let sources: [WidgetListSource] = [.today, .upcoming, .inbox, .project("p-1"), .savedFilter(7), .label("l:2")]
        for source in sources {
            XCTAssertEqual(WidgetListSource(id: source.id), source)
        }
        XCTAssertNil(WidgetListSource(id: "filter:abc"))
        XCTAssertNil(WidgetListSource(id: "project:"))
        XCTAssertNil(WidgetListSource(id: "other:1"))
    }

    func testSourcesLinkToTheirScreens() throws {
        XCTAssertEqual(WidgetListSource.label("l1").url?.absoluteString, "cria://label/l1")
        XCTAssertEqual(WidgetListSource.savedFilter(4).url?.absoluteString, "cria://filter/4")
        XCTAssertEqual(DeepLink(url: try XCTUnwrap(URL(string: "cria://label/l1"))), .label("l1"))
        XCTAssertEqual(DeepLink(url: try XCTUnwrap(URL(string: "cria://filter/4"))), .savedFilter(4))
        XCTAssertEqual(DeepLink(url: try XCTUnwrap(URL(string: "cria://filter/x"))), .inbox)
    }

    func testLabelLinkOpensTheLabelWhileItExists() throws {
        let store = try makeStore()
        let label = try store.createLabel(title: "errands")
        XCTAssertEqual(try DeepLink.label(label.localId).destination(in: store), .open(tab: .browse, route: .label(label.localId)))
        XCTAssertEqual(try DeepLink.label("gone").destination(in: store), .open(tab: .browse, route: nil))
        XCTAssertEqual(try DeepLink.savedFilter(99).destination(in: store), .open(tab: .browse, route: nil))
    }

    func testProjectListShowsOpenTasksWithDueLabels() throws {
        let store = try makeStore()
        let project = try seedProject(store, title: "Home")
        try store.createTask(TaskInput(title: "Late", projectLocalId: project, dueDate: "2026-06-01T10:00:00Z"))
        try store.createTask(TaskInput(title: "Undated", projectLocalId: project))
        let done = try store.createTask(TaskInput(title: "Finished", projectLocalId: project))
        try store.updateTask(localId: done.localId, patch: TaskPatch(done: true))

        let snapshot = try WidgetListSnapshot.load(
            store: store, source: .project(project), limit: 1, now: now, defaults: try isolatedDefaults()
        )
        XCTAssertEqual(snapshot.title, "Home")
        XCTAssertEqual(snapshot.total, 2)
        XCTAssertEqual(snapshot.entries.count, 1)
        XCTAssertFalse(snapshot.isMissing)
        let all = try WidgetListSnapshot.load(store: store, source: .project(project), limit: 5, now: now, defaults: try isolatedDefaults())
        XCTAssertEqual(Set(all.entries.map(\.title)), ["Late", "Undated"])
        let late = try XCTUnwrap(all.entries.first { $0.title == "Late" })
        XCTAssertTrue(late.isOverdue)
        XCTAssertNotNil(late.due)
        XCTAssertNil(all.entries.first { $0.title == "Undated" }?.due)
    }

    func testTodayHidesDueLabelsAndUpcomingShowsThem() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        try store.createTask(TaskInput(title: "Now", projectLocalId: project, dueDate: "2026-06-09T10:00:00Z"))
        try store.createTask(TaskInput(title: "Soon", projectLocalId: project, dueDate: "2026-06-20T10:00:00Z"))
        let defaults = try isolatedDefaults()

        let today = try WidgetListSnapshot.load(store: store, source: .today, limit: 5, now: now, defaults: defaults)
        XCTAssertEqual(today.entries.map(\.title), ["Now"])
        XCTAssertNil(today.entries.first?.due)
        let upcoming = try WidgetListSnapshot.load(store: store, source: .upcoming, limit: 5, now: now, defaults: defaults)
        XCTAssertEqual(upcoming.entries.map(\.title), ["Now", "Soon"])
        // "Today", with the time after it when the due date has one.
        XCTAssertEqual(upcoming.entries.first?.due?.hasPrefix("Today"), true)
    }

    func testLabelListShowsItsTasks() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Tagged", projectLocalId: project))
        try store.createTask(TaskInput(title: "Plain", projectLocalId: project))
        try store.applyLabels(byTitle: ["errands"], toTask: task.localId)
        let label = try XCTUnwrap(try store.labels().first { $0.title == "errands" })

        let snapshot = try WidgetListSnapshot.load(
            store: store, source: .label(label.localId), limit: 5, now: now, defaults: try isolatedDefaults()
        )
        XCTAssertEqual(snapshot.title, "errands")
        XCTAssertEqual(snapshot.entries.map(\.title), ["Tagged"])
    }

    func testGoneListsAndAnUnknownInboxSayMissing() throws {
        let store = try makeStore()
        let defaults = try isolatedDefaults()
        for source in [WidgetListSource.project("gone"), .label("gone"), .savedFilter(3), .inbox] {
            let snapshot = try WidgetListSnapshot.load(store: store, source: source, limit: 5, now: now, defaults: defaults)
            XCTAssertTrue(snapshot.isMissing, "\(source)")
            XCTAssertEqual(snapshot.total, 0)
        }
    }

    func testInboxIsTheRememberedDefaultProject() throws {
        let store = try makeStore()
        try seedProject(store, serverId: 1, title: "Work")
        let inbox = try seedProject(store, serverId: 2, title: "Inbox")
        try store.createTask(TaskInput(title: "Capture", projectLocalId: inbox))
        let defaults = try isolatedDefaults()
        try store.rememberCaptureProject(serverId: 2, defaults: defaults)

        let snapshot = try WidgetListSnapshot.load(store: store, source: .inbox, limit: 5, now: now, defaults: defaults)
        XCTAssertEqual(snapshot.title, "Inbox")
        XCTAssertEqual(snapshot.entries.map(\.title), ["Capture"])
    }

    func testChoicesListViewsThenProjectsAndLabelsAndNarrowByTitle() throws {
        let store = try makeStore()
        try seedProject(store, serverId: 1, title: "Zoo")
        try seedProject(store, serverId: 2, title: "Allotment")
        try store.createLabel(title: "errands")

        let titles = try store.widgetListChoices().map(\.title)
        XCTAssertEqual(titles, ["Today", "Upcoming", "Inbox", "Allotment", "Zoo", "errands"])
        XCTAssertEqual(try store.widgetListChoices(matching: "ERR").map(\.title), ["errands"])
    }
}
