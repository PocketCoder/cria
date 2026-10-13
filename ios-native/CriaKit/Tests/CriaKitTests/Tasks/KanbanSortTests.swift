import XCTest
@testable import CriaKit

final class KanbanSortTests: XCTestCase {
    private var store: CriaStore!
    private var project = ""

    override func setUpWithError() throws {
        store = try makeStore()
        project = try seedProject(store)
    }

    private func card(_ title: String, due: String?) throws -> KanbanCardPlan {
        let task = try store.createTask(TaskInput(title: title, projectLocalId: project, dueDate: due))
        return KanbanCardPlan(task: task, subtasks: [], parentTitle: nil)
    }

    func testSoonestFirstUndatedLastAndTiesKeepTheirOrder() throws {
        let cards = [
            try card("none A", due: nil), try card("later", due: "2026-10-20T09:00:00Z"), try card("none B", due: nil),
            try card("soon", due: "2026-10-14T09:00:00Z"), try card("soon too", due: "2026-10-14T09:00:00Z")
        ]
        XCTAssertEqual(KanbanSort.byDueDate(cards).map(\.task.title), ["soon", "soon too", "later", "none A", "none B"])
    }

    func testOffsetsAreComparedAsInstants() throws {
        // 10:00 at +02:00 is 08:00Z, which is before 09:00Z although its text sorts after it.
        let cards = [try card("nine utc", due: "2026-10-14T09:00:00Z"), try card("ten plus two", due: "2026-10-14T10:00:00+02:00")]
        XCTAssertEqual(KanbanSort.byDueDate(cards).map(\.task.title), ["ten plus two", "nine utc"])
    }
}
