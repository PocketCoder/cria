import XCTest
@testable import CriaKit

final class TaskUndoTests: XCTestCase {
    func testInverseRestoresOnlyTheFieldsThePatchSets() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "a", projectLocalId: project, dueDate: "2026-05-30T00:00:00Z", priority: 2))

        let patch = TaskPatch(dueDate: "2026-06-01T00:00:00Z", priority: 4)
        let inverse = patch.inverse(restoring: task)
        XCTAssertEqual(inverse.dueDate, "2026-05-30T00:00:00Z")
        XCTAssertEqual(inverse.priority, 2)
        XCTAssertNil(inverse.title)
        XCTAssertNil(inverse.done)
        XCTAssertNil(inverse.startDate)
    }

    func testInverseOfSettingADateOnADatelessTaskClearsIt() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "a", projectLocalId: project))
        XCTAssertEqual(TaskPatch(dueDate: "2026-06-01T00:00:00Z").inverse(restoring: task).dueDate, "")
    }

    func testCompleteThenUndoReopensTheTask() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "a", projectLocalId: project)).localId

        let step = try store.updateTaskUndoable(localId: task, patch: TaskPatch(done: true))
        XCTAssertEqual(step.message, "Task completed")
        XCTAssertEqual(try store.task(localId: task)?.done, true)
        XCTAssertTrue(try store.undo(step))
        XCTAssertEqual(try store.task(localId: task)?.done, false)
        XCTAssertNil(try store.task(localId: task)?.doneAt)
    }

    func testUndoOfARepeatingCompletionRestoresTheDatesAfterTheServerMovedThem() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        var input = TaskInput(title: "weekly", projectLocalId: project, dueDate: "2026-05-30T09:00:00Z")
        input.repeatAfter = 7 * 86_400
        let task = try store.createTask(input).localId
        _ = try store.updateTask(localId: task, patch: TaskPatch(dueDate: "2026-05-30T09:00:00Z"))

        let step = try store.updateTaskUndoable(localId: task, patch: TaskPatch(done: true))
        // What the server does on a repeating completion: dates move on and the task stays open.
        _ = try store.updateTask(localId: task, patch: TaskPatch(done: false))
        _ = try store.updateTask(localId: task, patch: TaskPatch(dueDate: "2026-06-06T09:00:00Z"))

        XCTAssertTrue(try store.undo(step))
        let restored = try XCTUnwrap(try store.task(localId: task))
        XCTAssertFalse(restored.done)
        XCTAssertEqual(restored.dueDate, "2026-05-30T09:00:00Z")
        XCTAssertEqual(restored.repeatAfter, 7 * 86_400)
    }

    func testUndoQueuesAnOrdinaryUpdateOp() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "a", projectLocalId: project)).localId
        let before = try outboxEntries(store, entity: "task").count
        let step = try store.updateTaskUndoable(localId: task, patch: TaskPatch(priority: 3))
        try store.undo(step)
        let entries = try outboxEntries(store, entity: "task")
        XCTAssertEqual(entries.count, before + 2)
        XCTAssertEqual(entries.last?.operation, "update")
    }

    func testMoveAndRescheduleUndo() throws {
        let store = try makeStore()
        let home = try seedProject(store, serverId: 1, title: "Home")
        let work = try seedProject(store, serverId: 2, title: "Work")
        let task = try store.createTask(TaskInput(title: "a", projectLocalId: home, dueDate: "2026-05-30T00:00:00Z")).localId

        var move = TaskPatch()
        move.projectLocalId = work
        let moved = try store.updateTaskUndoable(localId: task, patch: move)
        XCTAssertEqual(moved.message, "Task moved")
        let cleared = try store.updateTaskUndoable(localId: task, patch: TaskPatch(dueDate: ""))
        XCTAssertEqual(cleared.message, "Due date cleared")

        try store.undo(cleared)
        XCTAssertEqual(try store.task(localId: task)?.dueDate, "2026-05-30T00:00:00Z")
        try store.undo(moved)
        XCTAssertEqual(try store.task(localId: task)?.projectLocalId, home)
    }

    func testBulkActionsUndoAsOneStep() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let ids = try (0..<3).map {
            try store.createTask(TaskInput(title: "t\($0)", projectLocalId: project, dueDate: "2026-05-30T00:00:00Z")).localId
        }
        _ = try store.updateTask(localId: ids[2], patch: TaskPatch(done: true))

        let completed = try XCTUnwrap(store.bulkComplete(ids).undo)
        XCTAssertEqual(completed.message, "2 tasks completed")
        XCTAssertEqual(completed.entries.count, 2)
        try store.undo(completed)
        XCTAssertEqual(try ids.map { try XCTUnwrap(store.task(localId: $0)).done }, [false, false, true])

        let scheduled = try XCTUnwrap(store.bulkSchedule(ids, dueDate: "2026-07-01T00:00:00Z").undo)
        try store.undo(scheduled)
        XCTAssertEqual(try ids.map { try XCTUnwrap(store.task(localId: $0)).dueDate }, Array(repeating: "2026-05-30T00:00:00Z", count: 3))

        let prioritised = try XCTUnwrap(store.bulkSetPriority(ids, priority: 5).undo)
        try store.undo(prioritised)
        XCTAssertEqual(try ids.map { try XCTUnwrap(store.task(localId: $0)).priority }, [0, 0, 0])
        XCTAssertNil(store.bulkComplete([]).undo)
    }

    func testBulkMoveUndoSendsEachTaskBack() throws {
        let store = try makeStore()
        let home = try seedProject(store, serverId: 1, title: "Home")
        let work = try seedProject(store, serverId: 2, title: "Work")
        let ids = try (0..<2).map { try store.createTask(TaskInput(title: "t\($0)", projectLocalId: home)).localId }
        let step = try XCTUnwrap(store.bulkMove(ids, toProject: work).undo)
        XCTAssertEqual(step.message, "2 tasks moved")
        try store.undo(step)
        XCTAssertEqual(try ids.map { try XCTUnwrap(store.task(localId: $0)).projectLocalId }, [home, home])
    }

    func testBulkDeleteWithAWindowUndoesAsOneStep() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let ids = try (0..<2).map { try store.createTask(TaskInput(title: "t\($0)", projectLocalId: project)).localId }
        let step = try XCTUnwrap(store.bulkDelete(ids, undoWindow: 6).undo)
        XCTAssertEqual(step.message, "2 tasks deleted")
        XCTAssertNil(try store.task(localId: ids[0]))
        try store.undo(step)
        XCTAssertNotNil(try store.task(localId: ids[0]))
        XCTAssertNotNil(try store.task(localId: ids[1]))
        XCTAssertNil(store.bulkDelete([ids[0]]).undo, "no window, no undo step")
    }
}
