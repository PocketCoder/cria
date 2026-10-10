import XCTest
@testable import CriaKit

final class LabelRepositoryTests: XCTestCase {
    func testLabelUpsertQueuesNothingAndKeepsServerTitleFresh() throws {
        let store = try makeStore()
        let json = #"{"id": 4, "title": "urgent", "hex_color": "00ff00"}"#
        let localId = try store.upsertLabelFromServer(try decodeFixture(LabelResponse.self, json), rawJSON: json)
        XCTAssertEqual(try store.labels().map(\.title), ["urgent"])
        XCTAssertEqual(try outboxRows(store).count, 0)

        let renamed = #"{"id": 4, "title": "server name"}"#
        XCTAssertEqual(
            try store.upsertLabelFromServer(try decodeFixture(LabelResponse.self, renamed), rawJSON: renamed),
            localId
        )
        XCTAssertEqual(try store.labels().map(\.title), ["server name"])
    }

    func testToggleLinksThenUnlinksAndQueuesEachChange() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Tag me", projectLocalId: project))
        let json = #"{"id": 4, "title": "urgent"}"#
        let label = try store.upsertLabelFromServer(try decodeFixture(LabelResponse.self, json), rawJSON: json)

        try store.toggleTaskLabel(taskLocalId: task.localId, labelLocalId: label)
        XCTAssertEqual(try store.labels(forTask: task.localId).map(\.title), ["urgent"])

        try store.toggleTaskLabel(taskLocalId: task.localId, labelLocalId: label)
        XCTAssertEqual(try store.labels(forTask: task.localId).count, 0)

        let ops = try outboxRows(store).filter { $0["entity_type"] as String? == "task_label" }.map { $0["op"] as String? }
        XCTAssertEqual(ops, ["create", "delete"])
    }

    func testRemindersAndRelationsReplaceWithServerState() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Parent", projectLocalId: project))
        let reminders = try decodeFixture(TaskResponse.self, """
        {"id": 1, "project_id": 1, "title": "x", "reminders": [
          {"reminder": "2026-06-10T09:00:00Z"},
          {"reminder": "0001-01-01T00:00:00Z", "relative_period": -3600, "relative_to": "due_date"}
        ]}
        """).reminders ?? []
        try store.replaceRemindersFromServer(taskLocalId: task.localId, reminders)
        try store.replaceRemindersFromServer(taskLocalId: task.localId, reminders)
        let count = try store.database.writer.read { connection in
            try Int.fetchOne(connection, sql: "SELECT COUNT(*) FROM task_reminders WHERE task_local_id = ?", arguments: [task.localId]) ?? 0
        }
        XCTAssertEqual(count, 2)

        let related = try decodeFixture(TaskResponse.self, """
        {"id": 2, "project_id": 1, "title": "y", "related_tasks": {"subtask": [{"id": 7, "title": "child"}]}}
        """).relatedTasks ?? [:]
        try store.replaceRelationsFromServer(taskLocalId: task.localId, related)
        let kinds = try store.database.writer.read { connection in
            try String.fetchAll(connection, sql: "SELECT relation_kind FROM task_relations WHERE task_local_id = ?", arguments: [task.localId])
        }
        XCTAssertEqual(kinds, ["subtask"])
    }
}
