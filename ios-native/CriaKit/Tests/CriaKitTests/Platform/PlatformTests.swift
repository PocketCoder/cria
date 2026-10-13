import XCTest
@testable import CriaKit

final class PlatformTests: XCTestCase {
    private func link(_ text: String) throws -> DeepLink? {
        DeepLink(url: try XCTUnwrap(URL(string: text)))
    }

    func testParsesLinks() throws {
        XCTAssertEqual(try link("cria://task/42"), .task("42"))
        XCTAssertEqual(try link("cria://task/abc-def"), .task("abc-def"))
        XCTAssertEqual(try link("cria://project/7"), .project("7"))
        XCTAssertEqual(try link("cria://today"), .today)
        XCTAssertEqual(try link("cria://upcoming"), .upcoming)
        XCTAssertEqual(try link("cria://inbox"), .inbox)
        XCTAssertEqual(try link("cria://search"), .search)
        XCTAssertEqual(try link("cria://add?title=Buy%20milk"), .add(title: "Buy milk"))
        XCTAssertEqual(try link("cria://add"), .add(title: nil))
    }

    func testRejectsOtherSchemesAndHosts() throws {
        XCTAssertNil(try link("https://example.com/task/1"))
        XCTAssertNil(try link("cria://unknown/1"))
        XCTAssertEqual(try link("cria://task"), .today)
    }

    func testBuildsLocalLinks() {
        XCTAssertEqual(DeepLink.taskURL(localId: "abc")?.absoluteString, "cria://task/abc")
        XCTAssertEqual(DeepLink.projectURL(localId: "p1")?.absoluteString, "cria://project/p1")
    }

    func testResolvesServerAndLocalTaskIds() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let json = taskJSON(id: 55, projectId: 1, title: "Server task")
        let local = try XCTUnwrap(store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json))
        XCTAssertEqual(try DeepLink.task("55").destination(in: store), .open(tab: .browse, route: .task(local)))
        XCTAssertEqual(try DeepLink.task(local).destination(in: store), .open(tab: .browse, route: .task(local)))
        XCTAssertEqual(try DeepLink.task("999").destination(in: store), .open(tab: .today, route: nil))
        XCTAssertEqual(try DeepLink.project("1").destination(in: store), .open(tab: .browse, route: .project(project)))
        XCTAssertEqual(try DeepLink.project("nope").destination(in: store), .open(tab: .browse, route: nil))
        XCTAssertEqual(try DeepLink.add(title: "x").destination(in: store), .quickAdd(title: "x"))
    }

    func testShareContentPrefersPageTitleThenTextThenHost() throws {
        let url = try XCTUnwrap(URL(string: "https://example.com/a?b=1&c=2"))
        let titled = ShareContent.make(title: "A page", text: nil, url: url)
        XCTAssertEqual(titled?.title, "A page")
        let shown = "https://example.com/a?b=1&amp;c=2"
        XCTAssertEqual(titled?.descriptionHtml, "<p><a href=\"\(shown)\">\(shown)</a></p>")
        XCTAssertEqual(ShareContent.make(title: nil, text: "Line one\nLine two", url: nil)?.title, "Line one")
        XCTAssertEqual(ShareContent.make(title: " ", text: nil, url: url)?.title, "example.com")
        XCTAssertNil(ShareContent.make(title: nil, text: "  ", url: nil))
    }

    func testShareContentKeepsTextAsNotesAndEscapes() {
        let content = ShareContent.make(title: "Title", text: "a <b> & c", url: nil)
        XCTAssertEqual(content?.descriptionHtml, "<p>a &lt;b&gt; &amp; c</p>")
        XCTAssertNil(ShareContent.make(title: nil, text: "Only line", url: nil)?.descriptionHtml)
    }

    private func isolatedDefaults() throws -> UserDefaults {
        try XCTUnwrap(UserDefaults(suiteName: "cria.test.\(UUID().uuidString)"))
    }

    func testCaptureUsesRememberedProjectThenFirst() throws {
        let store = try makeStore()
        let first = try seedProject(store, serverId: 1, title: "First")
        let inbox = try seedProject(store, serverId: 2, title: "Inbox")
        let defaults = try isolatedDefaults()
        XCTAssertNotNil(try store.captureProjectId(defaults: defaults))
        try store.rememberCaptureProject(serverId: 2, defaults: defaults)
        XCTAssertEqual(try store.captureProjectId(defaults: defaults), inbox)
        let task = try store.captureTask(title: "Shared", descriptionHtml: "<p>x</p>", defaults: defaults)
        XCTAssertEqual(task?.projectLocalId, inbox)
        XCTAssertEqual(task?.description, "<p>x</p>")
        try store.rememberCaptureProject(serverId: 99, defaults: defaults)
        XCTAssertNotEqual(try store.captureProjectId(defaults: defaults), "99")
        XCTAssertTrue([first, inbox].contains(try XCTUnwrap(store.captureProjectId(defaults: defaults))))
    }

    func testCaptureWithNoProjectsDoesNothing() throws {
        let store = try makeStore()
        XCTAssertNil(try store.captureTask(title: "x", defaults: try isolatedDefaults()))
    }

    func testCapturedTaskQueuesAnOutboxRow() throws {
        let store = try makeStore()
        try seedProject(store)
        try store.captureTask(title: "From share", defaults: try isolatedDefaults())
        XCTAssertEqual(try outboxRows(store).count, 1)
    }

    func testTodaySnapshotCountsOverdueAndToday() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-06-09T10:00:00Z"))
        for (title, due) in [("Late", "2026-06-01T10:00:00Z"), ("Now", "2026-06-09T10:00:00Z"), ("Soon", "2026-06-20T10:00:00Z")] {
            try store.createTask(TaskInput(title: title, projectLocalId: project, dueDate: due))
        }
        let snapshot = try TodaySnapshot.load(store: store, limit: 1, now: now)
        XCTAssertEqual(snapshot.total, 2)
        XCTAssertEqual(snapshot.entries.map(\.title), ["Late"])
        XCTAssertEqual(snapshot.entries.first?.isOverdue, true)
    }

    func testPathsAreUnderTheRoot() {
        let root = URL(fileURLWithPath: "/tmp/cria-root")
        XCTAssertEqual(CriaPaths.databaseURL(root: root).path, "/tmp/cria-root/cria.sqlite")
        XCTAssertEqual(CriaPaths.blobDirectory(root: root).lastPathComponent, "blobs")
    }
}

#if os(macOS)
final class CriaPathsMacTests: XCTestCase {
    func testDataDirectoryIsTheNativeSubfolder() {
        XCTAssertEqual(CriaPaths.dataDirectory().lastPathComponent, "Native")
    }
}
#endif
