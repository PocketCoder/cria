import XCTest
@testable import CriaKit

final class TaskRepositoryTests: XCTestCase {
    func testOrderingPutsDoneLastThenUnpositionedThenPositionThenDueThenTitle() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let fixtures = [
            taskJSON(id: 1, title: "done one", done: true, position: 1),
            taskJSON(id: 2, title: "no position", position: nil),
            taskJSON(id: 3, title: "second", position: 2),
            taskJSON(id: 4, title: "first", position: 1),
            taskJSON(id: 5, title: "Alpha", position: 1, dueDate: "2026-06-01T00:00:00Z"),
            taskJSON(id: 6, title: "beta", position: 1, dueDate: "2026-07-01T00:00:00Z"),
        ]
        for json in fixtures {
            try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
        }
        let titles = try store.tasks(matching: TaskQuery(projectLocalId: project)).map(\.title)
        XCTAssertEqual(titles, ["Alpha", "beta", "first", "second", "no position", "done one"])
    }

    func testFavouritesAndDoneFilters() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let open = try store.createTask(TaskInput(title: "open", projectLocalId: project, isFavorite: true))
        _ = try store.createTask(TaskInput(title: "plain", projectLocalId: project))
        _ = try store.updateTask(localId: open.localId, patch: TaskPatch(done: true))

        XCTAssertEqual(try store.tasks(matching: TaskQuery(favoritesOnly: true)).map(\.title), ["open"])
        XCTAssertEqual(try store.tasks(matching: TaskQuery(projectLocalId: project, includeDone: false)).map(\.title), ["plain"])
    }

    func testCreateWritesRowAndQueuesCreate() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Buy milk", projectLocalId: project))

        XCTAssertNil(task.serverId)
        XCTAssertEqual(task.title, "Buy milk")
        let rows = try outboxRows(store)
        XCTAssertEqual(rows.map { $0["op"] as String? }, ["create"])
        XCTAssertEqual(rows.first?["entity_local_id"] as String?, task.localId)
    }

    func testUpdateAndSoftDeleteQueueOutbox() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Draft", projectLocalId: project))
        let updated = try store.updateTask(localId: task.localId, patch: TaskPatch(title: "Final", priority: 3))
        XCTAssertEqual(updated.title, "Final")
        XCTAssertEqual(updated.priority, 3)

        try store.deleteTask(localId: task.localId)
        XCTAssertEqual(try store.task(localId: task.localId) == nil, true)
        XCTAssertEqual(try outboxRows(store).map { $0["op"] as String? }, ["create", "update", "delete"])
    }

    func testServerUpsertKeepsPendingLocalEdit() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let json = taskJSON(id: 10, projectId: 1, title: "Original")
        let localId = try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
        let id = try XCTUnwrap(localId)
        _ = try store.updateTask(localId: id, patch: TaskPatch(title: "Local edit"))

        let remote = taskJSON(id: 10, projectId: 1, title: "Server edit")
        try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, remote), rawJSON: remote)

        let task = try XCTUnwrap(try store.task(localId: id))
        XCTAssertEqual(task.title, "Local edit")
        XCTAssertEqual(task.projectLocalId, project)
    }

    func testConflictRecordedOnlyWhenServerDivergedFromLastSync() throws {
        let store = try makeStore()
        try seedProject(store)
        let json = taskJSON(id: 10, projectId: 1, title: "Original")
        let id = try XCTUnwrap(try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json))
        _ = try store.updateTask(localId: id, patch: TaskPatch(title: "Local edit"))

        // Server unchanged since last sync: no conflict.
        try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
        XCTAssertEqual(try conflictCount(store), 0)

        // Server changed the title too: one conflict, and a repeat pull does not add another.
        let remote = taskJSON(id: 10, projectId: 1, title: "Server edit")
        try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, remote), rawJSON: remote)
        try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, remote), rawJSON: remote)
        XCTAssertEqual(try conflictCount(store), 1)
    }

    func testUpsertSkipsTasksWhoseProjectIsNotSynced() throws {
        let store = try makeStore()
        let json = taskJSON(id: 10, projectId: 99, title: "Orphan")
        let result = try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
        XCTAssertNil(result)
        XCTAssertEqual(try store.tasks(matching: TaskQuery()).count, 0)
    }

    private func conflictCount(_ store: CriaStore) throws -> Int {
        try store.database.writer.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM conflicts") ?? 0
        }
    }
}
