import GRDB
import XCTest
@testable import CriaKit

/// Regressions from the production-readiness review.
final class ProductionReviewTests: XCTestCase {
    private func addComment(_ store: CriaStore, taskLocalId: String) throws {
        try runSQL(store, """
            INSERT INTO task_comments (local_id, server_id, task_local_id, comment, updated_at, dirty, deleted)
            VALUES (?, 1, ?, 'hi', '2026-01-01T00:00:00Z', 0, 0)
            """, [UUID().uuidString, taskLocalId])
    }

    // MARK: Comments block hard deletes (task_comments has no ON DELETE clause)

    func testReconcileRemovesATaskThatHasComments() throws {
        let store = try makeStore()
        try seedProject(store)
        let task = try seedSyncedTask(store, serverId: 5)
        try addComment(store, taskLocalId: task)
        try store.removeTasksMissingOnServer(serverIds: [])
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks"), 0)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM task_comments"), 0)
    }

    func testRemovingAProjectLocallyRemovesItsTasksComments() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try seedSyncedTask(store, serverId: 5)
        try addComment(store, taskLocalId: task)
        try store.removeProjectLocally(localId: project)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM projects"), 0)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM task_comments"), 0)
    }

    // MARK: Wire format

    func testViewFilterObjectDecodesAsJSONText() throws {
        let view = try decodeFixture(ViewResponse.self, """
            {"id": 3, "title": "List", "project_id": 1, "view_kind": "list",
             "filter": {"filter": "done = false", "filter_include_nulls": false}}
            """)
        let text = try XCTUnwrap(view.filter)
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        XCTAssertEqual(object["filter"] as? String, "done = false")
    }

    func testViewFilterStringAndNullDecode() throws {
        let base = #""id": 3, "title": "L", "project_id": 1, "view_kind": "list""#
        let plain = try decodeFixture(ViewResponse.self, "{\(base), \"filter\": \"done = false\"}")
        XCTAssertEqual(plain.filter, "done = false")
        let none = try decodeFixture(ViewResponse.self, "{\(base), \"filter\": null}")
        XCTAssertNil(none.filter)
    }

    func testProjectIdentifierIsStoredAndSentBack() throws {
        let store = try makeStore()
        let json = #"{"id": 1, "title": "Work", "identifier": "WRK"}"#
        let localId = try XCTUnwrap(store.upsertProjectFromServer(try decodeFixture(ProjectResponse.self, json), rawJSON: json))
        let record = try XCTUnwrap(try store.projects().first { $0.localId == localId })
        XCTAssertEqual(record.identifier, "WRK")
        let body = try ProjectExecutor().body(record, store: store)
        XCTAssertEqual(body["identifier"], .string("WRK"))
    }

    func testPullDoesNotBringBackTasksHiddenByAProjectDelete() throws {
        let store = try makeStore()
        try seedProject(store)
        let task = try seedSyncedTask(store, serverId: 5)
        try runSQL(store, "UPDATE tasks SET deleted = 1 WHERE local_id = ?", [task])
        let json = taskJSON(id: 5, title: "Back?")
        XCTAssertNil(try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json))
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE deleted = 1"), 1)
    }

    // MARK: Editor

    func testListInsideAQuoteAfterAListDoesNotHang() {
        let html = "<ul><li><p>A</p></li></ul><blockquote><ul><li><p>x</p><ul><li><p>B</p></li></ul></li></ul></blockquote>"
        let out = RichDocument(html: html).html()
        XCTAssertTrue(out.contains("A"))
        XCTAssertTrue(out.contains("B"))
        XCTAssertTrue(out.contains("<blockquote>"))
    }

    func testDeepNestedQuoteListAfterShallowListDoesNotHang() {
        let html = "<ul><li><p>A</p></li></ul><blockquote><ul><li><ul><li><p>B</p></li></ul></li></ul></blockquote>"
        let out = RichDocument(html: html).html()
        XCTAssertTrue(out.contains("A"))
        XCTAssertTrue(out.contains("B"))
    }

    // MARK: Dates

    func testGregorianMathsOnABuddhistDevice() throws {
        var buddhist = Calendar(identifier: .buddhist)
        buddhist.timeZone = TimeZone(identifier: "Asia/Bangkok")!
        let now = try XCTUnwrap(DueDates.parse("2026-10-11T03:00:00Z"))
        // Writing through a Buddhist calendar must still give the Gregorian day.
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = buddhist.timeZone
        XCTAssertEqual(DueDates.allDayISO(for: now, calendar: gregorian), "2026-10-11T00:00:00Z")
        XCTAssertEqual(Calendar.cria.identifier, .gregorian)
    }

    func testSearchNextWeekdayMatchesQuickAdd() {
        // Monday 2026-05-25: "next friday" is 5 June in both parsers (chrono-node's reading).
        XCTAssertEqual(nextWeekdayOffset(6, from: 2), 11)
        // Sunday: next Friday is 5 days on, next Sunday 7.
        XCTAssertEqual(nextWeekdayOffset(6, from: 1), 5)
        XCTAssertEqual(nextWeekdayOffset(1, from: 1), 7)
    }

    func testUpcomingRemindersCompareInstantsNotText() throws {
        let store = try makeStore()
        try seedProject(store)
        let task = try seedSyncedTask(store, serverId: 5)
        // 09:30Z written with a -04:00 offset, and a past reminder written with +02:00.
        let insert = "INSERT INTO task_reminders (task_local_id, reminder_at, notified) VALUES (?, ?, 0)"
        try runSQL(store, insert, [task, "2026-10-11T05:30:00-04:00"])
        try runSQL(store, insert, [task, "2026-10-11T10:30:00+02:00"])
        let now = try XCTUnwrap(DueDates.parse("2026-10-11T09:00:00Z"))
        let upcoming = try store.upcomingReminders(after: now, limit: 60)
        XCTAssertEqual(upcoming.map(\.reminderAt), ["2026-10-11T05:30:00-04:00"])
    }

    // MARK: Transport and HTML

    func testPlusInAQueryIsEncoded() async throws {
        let transport = StubTransport { _, _ in (200, "[]", [:]) }
        let api = ApiClient(session: FakeSession(), core: HTTPCore(transport: transport))
        _ = try await api.searchUsers("c++")
        let query = try XCTUnwrap(transport.requests.first?.url?.query)
        XCTAssertTrue(query.contains("s=c%2B%2B"), query)
    }

    func testSanitiserKeepsDataImagesButNotSVG() {
        let png = HTMLSanitizer.sanitize(#"<p><img src="data:image/png;base64,AAAA"></p>"#)
        XCTAssertTrue(png.contains("data:image/png"))
        let svg = HTMLSanitizer.sanitize(#"<p><img src="data:image/svg+xml;base64,AAAA"></p>"#)
        XCTAssertFalse(svg.contains("data:image/svg"))
        let link = HTMLSanitizer.sanitize("<a href=\"\nhttps://example.com\">x</a>")
        XCTAssertTrue(link.contains("href"))
    }

    // MARK: Conflicts and subtasks

    func testSameInstantInAnotherOffsetIsNotAConflict() {
        XCTAssertTrue(conflictValuesEqual(field: "due_date", "2026-10-12T09:00:00+01:00", "2026-10-12T08:00:00Z"))
        XCTAssertTrue(conflictValuesEqual(field: "start_date", "0001-01-01T00:00:00Z", nil))
        XCTAssertFalse(conflictValuesEqual(field: "due_date", "2026-10-12T09:00:00Z", "2026-10-13T09:00:00Z"))
        XCTAssertTrue(conflictValuesEqual(field: "description", nil, ""))
        XCTAssertFalse(conflictValuesEqual(field: "title", "a", "b"))
    }

    func testCreateSubtaskLinksTheNewTaskUnderItsParent() throws {
        let store = try makeStore()
        try seedProject(store)
        let parent = try seedSyncedTask(store, serverId: 5)
        let child = try store.createSubtask(parentLocalId: parent, title: "  Buy rings ")
        XCTAssertEqual(child.title, "Buy rings")
        let relations = try store.relations(forTask: parent)
        XCTAssertEqual(relations.map(\.kind), ["subtask"])
        XCTAssertEqual(relations.first?.otherTaskLocalId, child.localId)
        let ops = try store.outboxRows().map(\.entityType)
        XCTAssertEqual(ops.firstIndex(of: "task").map { $0 < (ops.firstIndex(of: "task_relation") ?? 0) }, true)
    }

    // MARK: Undo, assignees, subtasks, synced prefs, images

    func testUndoDeleteBringsBackASyncedTask() throws {
        let store = try makeStore()
        try seedProject(store)
        let task = try seedSyncedTask(store, serverId: 5)
        try store.deleteTask(localId: task, undoWindow: 6)
        let head = try XCTUnwrap(try store.outboxHead())
        XCTAssertNotNil(head.nextAttemptAt, "the delete waits out the undo window")
        XCTAssertTrue(try store.undoDeleteTask(localId: task))
        XCTAssertNotNil(try store.task(localId: task))
        XCTAssertEqual(try store.outboxRows().count, 0)
        XCTAssertEqual(try countRows(store, "SELECT dirty FROM tasks WHERE local_id = ?", [task]), 0)
        XCTAssertFalse(try store.undoDeleteTask(localId: task))
    }

    func testAssigneesAddAndRemoveQueueOps() throws {
        let store = try makeStore()
        try seedProject(store)
        let task = try seedSyncedTask(store, serverId: 5)
        try store.addAssignee(taskLocalId: task, userId: 7, username: "sam")
        XCTAssertEqual(try store.assignees(forTask: task).map(\.username), ["sam"])
        try store.removeAssignee(taskLocalId: task, userId: 7)
        XCTAssertTrue(try store.assignees(forTask: task).isEmpty)
        XCTAssertEqual(try store.outboxRows().map(\.op), ["add", "remove"])
    }

    func testNestPutsSubtasksUnderTheirParent() throws {
        let store = try makeStore()
        try seedProject(store)
        let parent = try seedSyncedTask(store, serverId: 1, title: "Parent")
        let other = try seedSyncedTask(store, serverId: 2, title: "Other")
        let child = try store.createSubtask(parentLocalId: parent, title: "Child")
        let items = try store.taskItems(.project(try XCTUnwrap(try store.projects().first?.localId)))
        let nested = TaskTree.nest(items, children: try store.subtaskMap())
        let parentIndex = try XCTUnwrap(nested.firstIndex { $0.id == parent })
        XCTAssertEqual(nested[parentIndex + 1].id, child.localId)
        XCTAssertEqual(nested[parentIndex + 1].depth, 1)
        XCTAssertTrue(nested[parentIndex].hasChildren)
        XCTAssertEqual(nested.first { $0.id == other }?.depth, 0)
        XCTAssertEqual(nested.count, items.count)
    }

    func testSyncedPreferencesApplyAndDiff() {
        var prefs = LocalPreferences.default
        prefs = SyncedPreferences.applying(["colorScheme": .string("dark"), "timeFormat": .string("12h")], to: prefs)
        XCTAssertEqual(prefs.colorScheme, .dark)
        XCTAssertEqual(prefs.timeFormat, .h12)
        var changed = prefs
        changed.colorScheme = .system
        XCTAssertEqual(SyncedPreferences.change(from: prefs, to: changed)?.cria, ["colorScheme": .string("system")])
        XCTAssertNil(SyncedPreferences.change(from: prefs, to: prefs))
    }

    func testServerImagePathOnlyForTheServer() throws {
        let url = try XCTUnwrap(URL(string: "https://vk.example/api/v1/tasks/3/attachments/9"))
        XCTAssertEqual(AppServices.apiPath(of: url, base: "https://vk.example"), "/tasks/3/attachments/9")
        XCTAssertNil(AppServices.apiPath(of: url, base: "https://other.example"))
    }
}
