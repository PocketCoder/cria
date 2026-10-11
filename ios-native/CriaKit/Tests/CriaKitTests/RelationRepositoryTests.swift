import XCTest
@testable import CriaKit

final class RelationRepositoryTests: XCTestCase {
    func testAddStoresBothDirectionsAndQueuesOneAdd() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let parent = try store.createTask(TaskInput(title: "Parent", projectLocalId: project))
        let child = try store.createTask(TaskInput(title: "Child", projectLocalId: project))

        try store.addRelation(taskLocalId: parent.localId, otherTaskLocalId: child.localId, kind: .subtask)

        let forward = try store.relations(forTask: parent.localId)
        XCTAssertEqual(forward.map(\.kind), ["subtask"])
        XCTAssertEqual(forward.map(\.otherTitle), ["Child"])
        XCTAssertEqual(try store.relations(forTask: child.localId).map(\.kind), ["parenttask"])

        let entries = try outboxEntries(store, entity: "task_relation")
        XCTAssertEqual(entries.map(\.operation), ["add"])
        let payload = try payloadObject(try XCTUnwrap(entries.first))
        XCTAssertEqual(payload["kind"] as? String, "subtask")
        XCTAssertEqual(payload["other_task_local_id"] as? String, child.localId)
    }

    func testRemoveDeletesBothDirectionsAndQueuesRemove() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let first = try store.createTask(TaskInput(title: "First", projectLocalId: project))
        let second = try store.createTask(TaskInput(title: "Second", projectLocalId: project))
        try store.addRelation(taskLocalId: first.localId, otherTaskLocalId: second.localId, kind: .blocking)

        let relation = try XCTUnwrap(try store.relations(forTask: first.localId).first)
        try store.removeRelation(taskLocalId: first.localId, relation: relation)

        XCTAssertEqual(try store.relations(forTask: first.localId).count, 0)
        XCTAssertEqual(try store.relations(forTask: second.localId).count, 0)
        XCTAssertEqual(try outboxEntries(store, entity: "task_relation").map(\.operation), ["add", "remove"])
    }

    func testRelationToSelfIsIgnored() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Solo", projectLocalId: project))
        try store.addRelation(taskLocalId: task.localId, otherTaskLocalId: task.localId, kind: .related)
        XCTAssertEqual(try store.relations(forTask: task.localId).count, 0)
        XCTAssertEqual(try outboxEntries(store, entity: "task_relation").count, 0)
    }
}
