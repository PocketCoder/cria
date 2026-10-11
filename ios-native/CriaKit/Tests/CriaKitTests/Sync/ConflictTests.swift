import GRDB
import XCTest
@testable import CriaKit

final class ConflictTests: XCTestCase {
    private func seedConflict() throws -> (CriaStore, String, Int) {
        let store = try makeStore()
        try seedProject(store)
        let local = try seedSyncedTask(store, serverId: 10, title: "base")
        try store.updateTask(localId: local, patch: TaskPatch(title: "mine", priority: 1))
        let remote = #"""
            {"id": 10, "project_id": 1, "title": "theirs", "priority": 4, "done": true,
             "due_date": "0001-01-01T00:00:00Z", "updated": "2026-02-01T00:00:00Z"}
            """#
        try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, remote), rawJSON: remote)
        let conflict = try XCTUnwrap(try store.unresolvedConflicts().first)
        return (store, local, conflict.id)
    }

    func testTwoClientEditProducesAConflictListingTheDivergedFields() throws {
        let (store, local, _) = try seedConflict()
        let conflicts = try store.unresolvedConflicts()
        XCTAssertEqual(conflicts.count, 1)
        XCTAssertEqual(conflicts[0].entityLocalId, local)
        XCTAssertTrue(conflicts[0].fields.contains("title"))
        let title = try XCTUnwrap(conflicts[0].diff.first { $0.field == "title" })
        XCTAssertEqual(title.label, "Title")
        XCTAssertEqual(title.local, "base")
        XCTAssertEqual(title.remote, "theirs")
    }

    func testKeepMineResolvesAndLeavesTheEditQueued() throws {
        let (store, local, id) = try seedConflict()
        try store.resolveConflictKeepMine(id: id)
        XCTAssertTrue(try store.unresolvedConflicts().isEmpty)
        let task = try XCTUnwrap(try store.task(localId: local))
        XCTAssertEqual(task.title, "mine")
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE dirty = 1"), 1)
        XCTAssertEqual(try store.outboxRows().count, 1)
    }

    func testUseTheirsOverwritesClearsDirtyAndDropsTheQueuedPush() throws {
        let (store, local, id) = try seedConflict()
        try store.resolveConflictUseTheirs(id: id)
        XCTAssertTrue(try store.unresolvedConflicts().isEmpty)
        let task = try XCTUnwrap(try store.task(localId: local))
        XCTAssertEqual(task.title, "theirs")
        XCTAssertEqual(task.priority, 4)
        XCTAssertTrue(task.done)
        XCTAssertNil(task.dueDate)
        XCTAssertEqual(try countRows(store, "SELECT COUNT(*) FROM tasks WHERE dirty = 1"), 0)
        XCTAssertEqual(try store.outboxRows().count, 0)
    }

    func testResolutionAnnouncesConflicts() async throws {
        let (store, _, id) = try seedConflict()
        var iterator = store.bus.subscribe().makeAsyncIterator()
        try store.resolveConflictKeepMine(id: id)
        let kind = await iterator.next()
        XCTAssertEqual(kind, .conflicts)
    }

    func testDiffRendersBooleansNumbersAndMissingValues() {
        let diff = diffConflict(
            fields: ["done", "priority", "due_date", "title"],
            localSnapshot: #"{"done": false, "priority": 1, "due_date": "0001-01-01T00:00:00Z"}"#,
            remoteSnapshot: #"{"done": true, "priority": 4, "title": "x"}"#
        )
        XCTAssertEqual(diff.map(\.local), ["no", "1", "—", "—"])
        XCTAssertEqual(diff.map(\.remote), ["yes", "4", "—", "x"])
    }
}
