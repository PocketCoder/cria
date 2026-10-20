import XCTest
@testable import CriaKit

final class PendingUndoTests: XCTestCase {
    private func makeDefaults() throws -> UserDefaults {
        let name = "cria.test.pendingUndo.\(UUID().uuidString)"
        return try XCTUnwrap(UserDefaults(suiteName: name))
    }

    func testSavedStepRoundTripsAndUndoes() throws {
        let defaults = try makeDefaults()
        let store = try makeStore()
        let project = try seedProject(store)
        let task = try store.createTask(TaskInput(title: "a", projectLocalId: project)).localId
        let step = try store.updateTaskUndoable(localId: task, patch: TaskPatch(done: true))

        PendingUndo.save(step, defaults: defaults)
        let taken = PendingUndo.take(defaults: defaults)
        XCTAssertEqual(taken, [step])
        XCTAssertTrue(PendingUndo.take(defaults: defaults).isEmpty, "taking clears them")

        try store.undo(try XCTUnwrap(taken.first))
        XCTAssertEqual(try store.task(localId: task)?.done, false)
    }

    func testExpiredAndEmptyStepsAreDropped() throws {
        let defaults = try makeDefaults()
        let step = TaskUndoStep(message: "x", entries: [.init(taskLocalId: "t", inverse: TaskPatch(done: false))])
        let saved = Date(timeIntervalSince1970: 1_000)
        PendingUndo.save(step, defaults: defaults, now: saved)
        PendingUndo.save(TaskUndoStep(message: "empty"), defaults: defaults, now: saved)
        XCTAssertTrue(PendingUndo.take(defaults: defaults, now: saved.addingTimeInterval(PendingUndo.lifetime + 1)).isEmpty)
        PendingUndo.save(step, defaults: defaults, now: saved)
        XCTAssertEqual(PendingUndo.take(defaults: defaults, now: saved.addingTimeInterval(5)), [step])
    }
}
