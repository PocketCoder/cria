import XCTest
@testable import CriaKit

final class TaskBatchLookupTests: XCTestCase {
    func testReturnsLiveTasksByLocalIdAndSkipsDeletedAndUnknown() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        let open = try store.createTask(TaskInput(title: "open", projectLocalId: project))
        let done = try store.createTask(TaskInput(title: "done", projectLocalId: project))
        _ = try store.updateTask(localId: done.localId, patch: TaskPatch(done: true))
        let gone = try store.createTask(TaskInput(title: "gone", projectLocalId: project))
        try store.deleteTask(localId: gone.localId)

        let found = try store.tasks(localIds: [open.localId, done.localId, gone.localId, "missing", open.localId])

        XCTAssertEqual(Set(found.keys), [open.localId, done.localId])
        XCTAssertEqual(found[open.localId], try store.task(localId: open.localId))
        XCTAssertEqual(found[done.localId]?.done, true)
    }

    func testEmptyInputReadsNothing() throws {
        let store = try makeStore()
        XCTAssertEqual(try store.tasks(localIds: [String]()), [:])
    }

    func testMoreIdsThanOneChunk() throws {
        let store = try makeStore()
        let project = try seedProject(store)
        var ids: [String] = []
        for index in 0..<520 {
            ids.append(try store.createTask(TaskInput(title: "task \(index)", projectLocalId: project)).localId)
        }
        let found = try store.tasks(localIds: ids + (0..<10).map { "missing \($0)" })
        XCTAssertEqual(found.count, 520)
        XCTAssertEqual(found[ids[519]]?.title, "task 519")
    }
}
