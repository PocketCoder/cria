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
        let plain = try decodeFixture(ViewResponse.self, #"{"id": 3, "title": "L", "project_id": 1, "view_kind": "list", "filter": "done = false"}"#)
        XCTAssertEqual(plain.filter, "done = false")
        let none = try decodeFixture(ViewResponse.self, #"{"id": 3, "title": "L", "project_id": 1, "view_kind": "list", "filter": null}"#)
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
}
