import XCTest
@testable import CriaKit

/// S-91: the hot read paths run a fixed number of SQL statements, however many tasks there are. A per-row query (N+1)
/// would make the count grow with the dataset. Unlike the timing budgets, this does not depend on speed, so it runs in
/// debug builds and CI too.
final class ReadPathStatementCountTests: XCTestCase {
    private typealias Read = (label: String, body: (PerfFixture) throws -> Void)

    private let reads: [Read] = {
        let now = PerfFixture.now
        var reads: [Read] = [
            ("today groups", { _ = try $0.store.smartGroups(.today, now: now) }),
            ("upcoming groups", { _ = try $0.store.smartGroups(.upcoming, now: now) }),
            ("project list + nesting", { fixture in
                let items = try fixture.store.taskItems(.project(fixture.bigProjectId), includeDone: true)
                _ = TaskTree.nest(items, children: try fixture.store.subtaskMap())
            }),
            ("label list", { _ = try $0.store.taskItems(.label("l-3")) }),
            ("favourites list", { _ = try $0.store.taskItems(.favorites) }),
            ("search text", { _ = try $0.store.search("garden report", now: now) }),
            ("search text + label + priority", { _ = try $0.store.search("invoice #label3 !3", now: now) }),
            ("search text + date range", { _ = try $0.store.search("budget next week", now: now) }),
            ("kanban manual board + labels", { fixture in
                let columns = try fixture.store.kanbanColumns(viewLocalId: fixture.manualBoardViewId)
                _ = try fixture.store.attachRowData(columns.flatMap(\.tasks))
            }),
            ("kanban filter columns", { _ = try $0.store.kanbanColumns(viewLocalId: $0.filterBoardViewId) }),
            ("gantt data", { _ = try $0.store.ganttData(projectLocalId: $0.bigProjectId, includeDone: true) }),
            ("upcoming reminders", { _ = try $0.store.upcomingReminders(after: now, limit: 64) })
        ]
        for index in 1...PerfFixture.savedFilterQueries.count {
            reads.append(("saved filter \(index)", { _ = try $0.store.smartGroups(.savedFilter(serverId: index), now: now) }))
        }
        return reads
    }()

    private func statementCounts(taskCount: Int) throws -> [String: Int] {
        let counter = StatementCounter()
        let fixture = try makePerfFixture(taskCount: taskCount, counter: counter)
        var counts: [String: Int] = [:]
        for read in reads {
            counter.reset()
            try read.body(fixture)
            counts[read.label] = counter.value
        }
        return counts
    }

    func testStatementCountsDoNotGrowWithTheNumberOfTasks() throws {
        let small = try statementCounts(taskCount: 200)
        let large = try statementCounts(taskCount: 600)
        for read in reads {
            let before = try XCTUnwrap(small[read.label])
            XCTAssertGreaterThan(before, 0, "\(read.label) ran no SQL: is the counter wired?")
            XCTAssertEqual(large[read.label], before, "\(read.label): statements grew with the task count (a per-row query?)")
        }
    }
}
