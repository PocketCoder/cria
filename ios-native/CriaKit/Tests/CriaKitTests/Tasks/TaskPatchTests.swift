import XCTest
@testable import CriaKit

final class TaskPatchTests: XCTestCase {
    func testDetailFieldsPersistAndQueueFullObject() throws {
        let store = try makeStore()
        let first = try seedProject(store, serverId: 1, title: "One")
        let second = try seedProject(store, serverId: 2, title: "Two")
        let task = try store.createTask(TaskInput(title: "Edit me", projectLocalId: first))

        var patch = TaskPatch(priority: 4)
        patch.description = "<p>notes</p>"
        patch.startDate = "2026-06-01T00:00:00Z"
        patch.endDate = "2026-06-03T00:00:00Z"
        patch.percentDone = 0.5
        patch.projectLocalId = second
        let updated = try store.updateTask(localId: task.localId, patch: patch)

        XCTAssertEqual(updated.description, "<p>notes</p>")
        XCTAssertEqual(updated.startDate, "2026-06-01T00:00:00Z")
        XCTAssertEqual(updated.endDate, "2026-06-03T00:00:00Z")
        XCTAssertEqual(updated.percentDone, 0.5)
        XCTAssertEqual(updated.projectLocalId, second)
        XCTAssertEqual(updated.priority, 4)

        let entries = try outboxEntries(store, entity: "task")
        XCTAssertEqual(entries.map(\.operation), ["create", "update"])
        let payload = try payloadObject(entries[1])
        XCTAssertEqual(payload["project_local_id"] as? String, second)
        XCTAssertEqual(payload["percent_done"] as? Double, 0.5)
    }

    func testUntouchedFieldsStayPut() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "Keep", projectLocalId: project, dueDate: "2026-06-01T00:00:00Z", priority: 2))
        let updated = try store.updateTask(localId: task.localId, patch: TaskPatch(title: "Kept"))
        XCTAssertEqual(updated.dueDate, "2026-06-01T00:00:00Z")
        XCTAssertEqual(updated.priority, 2)
    }

    func testPercentZeroIsApplied() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "p", projectLocalId: project))
        var raise = TaskPatch()
        raise.percentDone = 0.8
        _ = try store.updateTask(localId: task.localId, patch: raise)
        var lower = TaskPatch()
        lower.percentDone = 0
        XCTAssertEqual(try store.updateTask(localId: task.localId, patch: lower).percentDone, 0)
    }
}

final class LabelMutationTests: XCTestCase {
    func testCreateLabelQueuesCreate() throws {
        let store = try makeStore()
        let label = try store.createLabel(title: "errands", hexColor: "ff0000")
        XCTAssertNil(label.serverId)
        XCTAssertEqual(try store.labels().map(\.title), ["errands"])
        XCTAssertEqual(try outboxEntries(store, entity: "label").map(\.operation), ["create"])
    }

    func testApplyByTitleReusesExistingCaseInsensitivelyAndCreatesMissing() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "t", projectLocalId: project))
        let existing = try store.createLabel(title: "Errands")

        try store.applyLabels(byTitle: ["errands", " Home ", "HOME", ""], toTask: task.localId)

        XCTAssertEqual(try store.labels().map(\.title), ["Errands", "Home"])
        XCTAssertEqual(try store.labels(forTask: task.localId).map(\.title), ["Errands", "Home"])
        XCTAssertEqual(try store.labels().filter { $0.localId == existing.localId }.count, 1)
    }

    func testApplyingTwiceDoesNotUnlink() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "t", projectLocalId: project))
        try store.applyLabels(byTitle: ["a"], toTask: task.localId)
        try store.applyLabels(byTitle: ["a"], toTask: task.localId)
        XCTAssertEqual(try store.labels(forTask: task.localId).map(\.title), ["a"])
    }
}
