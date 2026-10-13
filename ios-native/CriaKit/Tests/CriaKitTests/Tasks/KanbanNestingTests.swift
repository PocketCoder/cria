import XCTest
@testable import CriaKit

final class KanbanNestingTests: XCTestCase {
    private var store: CriaStore!
    private var project = ""

    override func setUpWithError() throws {
        store = try makeStore()
        project = try seedProject(store)
    }

    private func task(_ title: String, done: Bool = false) throws -> TaskRecord {
        let created = try store.createTask(TaskInput(title: title, projectLocalId: project))
        return done ? try store.updateTask(localId: created.localId, patch: TaskPatch(done: true)) : created
    }

    private func column(_ name: String, _ tasks: [TaskRecord]) -> KanbanColumn {
        let bucket = BucketRecord(
            localId: name, serverId: nil, viewLocalId: "v", title: name, position: 0, limit: 0, createdByServerId: nil, updatedAt: ""
        )
        return KanbanColumn(bucket: bucket, tasks: tasks, positions: [:])
    }

    private func ids(_ plan: KanbanColumnPlan) -> [String] { plan.cards.map(\.task.title) }

    func testSubtaskInTheParentsColumnRidesInsideTheParentCard() throws {
        let parent = try task("Parent"), one = try task("One"), two = try task("Two", done: true), other = try task("Other")
        let plan = KanbanNesting.plan(
            columns: [column("todo", [parent, one, other, two])],
            children: [parent.localId: [one.localId, two.localId]]
        )
        let todo = plan.column("todo")
        XCTAssertEqual(ids(todo), ["Parent", "Other"])
        XCTAssertEqual(todo.cards[0].subtasks.map(\.task.title), ["One", "Two"])
        XCTAssertEqual(todo.cards[0].doneSubtasks, 1)
        XCTAssertEqual(todo.hiddenCount, 0)
        XCTAssertNil(todo.cards[0].parentTitle)
    }

    func testSubtaskInAnotherColumnIsItsOwnCardNamingTheParent() throws {
        let parent = try task("Parent"), child = try task("Child")
        let plan = KanbanNesting.plan(
            columns: [column("todo", [parent]), column("doing", [child])], children: [parent.localId: [child.localId]]
        )
        XCTAssertEqual(ids(plan.column("todo")), ["Parent"])
        XCTAssertTrue(plan.column("todo").cards[0].subtasks.isEmpty)
        XCTAssertEqual(ids(plan.column("doing")), ["Child"])
        XCTAssertEqual(plan.column("doing").cards[0].parentTitle, "Parent")
    }

    func testSubtaskWhoseParentIsNotOnTheBoardIsAPlainCard() throws {
        let child = try task("Child")
        let plan = KanbanNesting.plan(columns: [column("todo", [child])], children: ["elsewhere": [child.localId]])
        XCTAssertEqual(ids(plan.column("todo")), ["Child"])
        XCTAssertNil(plan.column("todo").cards[0].parentTitle)
    }

    func testBoardFilterAppliesToParentsAndHidesNestedSubtasks() throws {
        let parent = try task("Parent"), one = try task("One"), two = try task("Two")
        let columns = [column("todo", [parent, one, two])]
        let children = [parent.localId: [one.localId, two.localId]]
        let hidesTwo = KanbanNesting.plan(columns: columns, children: children) { $0.title != "Two" }
        XCTAssertEqual(hidesTwo.column("todo").cards[0].subtasks.map(\.task.title), ["One"])
        XCTAssertEqual(hidesTwo.hiddenCount, 1)
        // A hidden parent hands its shown subtasks up as plain cards.
        let hidesParent = KanbanNesting.plan(columns: columns, children: children) { $0.title != "Parent" }
        XCTAssertEqual(ids(hidesParent.column("todo")), ["One", "Two"])
        XCTAssertEqual(hidesParent.hiddenCount, 1)
        // A parent hidden by the filter is not named on a subtask in another column.
        let apart = KanbanNesting.plan(
            columns: [column("a", [parent]), column("b", [one])], children: children
        ) { $0.title != "Parent" }
        XCTAssertNil(apart.column("b").cards[0].parentTitle)
        XCTAssertEqual(apart.hiddenCount, 1)
    }

    func testGrandchildrenAreListedFlatWithDepth() throws {
        let parent = try task("Parent"), child = try task("Child"), grand = try task("Grand")
        let plan = KanbanNesting.plan(
            columns: [column("todo", [parent, child, grand])],
            children: [parent.localId: [child.localId], child.localId: [grand.localId]]
        )
        let rows = plan.column("todo").cards[0].subtasks
        XCTAssertEqual(rows.map(\.task.title), ["Child", "Grand"])
        XCTAssertEqual(rows.map(\.depth), [0, 1])
    }

    func testGrandchildAwayFromItsParentNamesThatParent() throws {
        let parent = try task("Parent"), child = try task("Child"), grand = try task("Grand")
        let plan = KanbanNesting.plan(
            columns: [column("a", [parent, child]), column("b", [grand])],
            children: [parent.localId: [child.localId], child.localId: [grand.localId]]
        )
        XCTAssertEqual(plan.column("b").cards[0].parentTitle, "Child")
        XCTAssertEqual(plan.column("a").cards[0].subtasks.map(\.task.title), ["Child"])
    }

    func testParentCycleStillShowsEveryTaskOnce() throws {
        let one = try task("One"), two = try task("Two")
        let plan = KanbanNesting.plan(
            columns: [column("todo", [one, two])], children: [one.localId: [two.localId], two.localId: [one.localId]]
        )
        XCTAssertEqual(ids(plan.column("todo")), ["One"])
        XCTAssertEqual(plan.column("todo").cards[0].subtasks.map(\.task.title), ["Two"])
        XCTAssertEqual(plan.hiddenCount, 0)
    }

    func testATaskInSeveralColumnsOfAFilterBoardNestsOnlyWhereItsParentIs() throws {
        let parent = try task("Parent"), child = try task("Child")
        let plan = KanbanNesting.plan(
            columns: [column("a", [parent, child]), column("b", [child])], children: [parent.localId: [child.localId]]
        )
        XCTAssertEqual(ids(plan.column("a")), ["Parent"])
        XCTAssertEqual(ids(plan.column("b")), ["Child"])
        XCTAssertEqual(plan.column("b").cards[0].parentTitle, "Parent")
    }

    func testColumnTaskListStaysWholeForCountsAndLimits() throws {
        let parent = try task("Parent"), child = try task("Child")
        let nested = column("todo", [parent, child])
        _ = KanbanNesting.plan(columns: [nested], children: [parent.localId: [child.localId]])
        XCTAssertEqual(nested.tasks.count, 2)
    }

    func testReadsTheSubtaskMapForRealRelations() throws {
        let parent = try task("Parent")
        let child = try store.createSubtask(parentLocalId: parent.localId, title: "Child")
        let map = try store.subtaskMap(projectLocalId: project)
        let plan = KanbanNesting.plan(columns: [column("todo", [parent, child])], children: map)
        XCTAssertEqual(ids(plan.column("todo")), ["Parent"])
        XCTAssertEqual(plan.column("todo").cards[0].subtasks.map(\.task.title), ["Child"])
    }

    func testBoardNestingStatementsDoNotGrowWithTheNumberOfTasks() throws {
        func statements(taskCount: Int) throws -> Int {
            let counter = StatementCounter()
            let fixture = try makePerfFixture(taskCount: taskCount, counter: counter)
            let columns = try fixture.store.kanbanColumns(viewLocalId: fixture.manualBoardViewId)
            counter.reset()
            let map = try fixture.store.subtaskMap(projectLocalId: fixture.boardProjectId)
            _ = KanbanNesting.plan(columns: columns, children: map)
            return counter.value
        }
        let small = try statements(taskCount: 200)
        XCTAssertGreaterThan(small, 0, "the counter is not wired")
        XCTAssertEqual(try statements(taskCount: 600), small)
    }
}
