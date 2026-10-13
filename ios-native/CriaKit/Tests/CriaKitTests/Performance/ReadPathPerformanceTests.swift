import GRDB
import XCTest
@testable import CriaKit

/// S-91: timing budgets for the hot read paths on a 5,000-task account (see `PerfFixture`).
///
/// Budgets are about five times the Linux release-build median (noted beside each), so a real regression (an accidental
/// full scan, a per-row query, quadratic work) fails while a slower machine passes. Linux numbers are dominated by
/// swift-corelibs-foundation's `ISO8601DateFormatter` (about 65 µs a parse), so Apple platforms run well inside them.
///
/// Budgets apply to optimised builds only: run `swift test -c release -Xswiftc -enable-testing --filter ReadPath`.
/// A debug build (what CI runs) is several times slower and too noisy to time, so there each read runs once, as a
/// smoke test on the full dataset, and no budget is checked. The per-row query check in `ReadPathStatementCountTests`
/// does not depend on speed and runs in every build.
final class ReadPathPerformanceTests: XCTestCase {
    private static let fixture: PerfFixture = {
        do { return try makePerfFixture() } catch { fatalError("fixture failed: \(error)") }
    }()

    private var fixture: PerfFixture { Self.fixture }
    private var store: CriaStore { fixture.store }
    private let now = PerfFixture.now

    private func assertWithin(_ budget: Double, _ label: String, runs: Int = 5, _ body: () throws -> Void) rethrows {
        #if DEBUG
        try body()
        #else
        let median = try timed(label, runs: runs, body)
        XCTAssertLessThan(median, budget, "\(label) took \(median) ms, budget \(budget) ms")
        #endif
    }

    func testFixtureHasTheExpectedShape() throws {
        func count(_ table: String) throws -> Int { try countRows(store, "SELECT COUNT(*) FROM \(table)") }
        XCTAssertEqual(try count("tasks"), 5_000)
        XCTAssertEqual(try count("projects"), 30)
        XCTAssertEqual(try count("labels"), 40)
        XCTAssertEqual(try count("task_labels"), 8_000)
        XCTAssertGreaterThanOrEqual(try countRows(store, "SELECT COUNT(*) FROM task_relations WHERE relation_kind = 'subtask'"), 290)
        XCTAssertGreaterThan(try count("task_reminders"), 400)
        XCTAssertGreaterThan(try count("task_comments"), 200)
    }

    // MARK: Smart views

    func testTodayGroups() throws {
        // Linux release: 412 ms.
        try assertWithin(2_000, "today groups") { _ = try store.smartGroups(.today, now: now) }
    }

    func testUpcomingGroups() throws {
        // Linux release: 796 ms.
        try assertWithin(4_000, "upcoming groups") { _ = try store.smartGroups(.upcoming, now: now) }
    }

    func testSavedFilterGroups() throws {
        for index in 1...PerfFixture.savedFilterQueries.count {
            // Linux release: 61 to 79 ms.
            try assertWithin(400, "saved filter \(index)") { _ = try store.smartGroups(.savedFilter(serverId: index), now: now) }
        }
    }

    // MARK: Project list

    func testProjectListWithNesting() throws {
        let project = fixture.bigProjectId
        // Linux release: 72 ms.
        try assertWithin(400, "project list + nesting") {
            let items = try store.taskItems(.project(project), includeDone: true)
            _ = TaskTree.nest(items, children: try store.subtaskMap())
        }
    }

    func testLabelAndFavouriteLists() throws {
        // Linux release: 52 ms.
        try assertWithin(300, "label list") { _ = try store.taskItems(.label("l-3")) }
        // Linux release: 55 ms.
        try assertWithin(300, "favourites list") { _ = try store.taskItems(.favorites) }
    }

    // MARK: Search

    func testSearchWithText() throws {
        // Linux release: 51 ms.
        try assertWithin(300, "search text") { _ = try store.search("invoice", now: now) }
        // Linux release: 59 ms.
        try assertWithin(300, "search two words") { _ = try store.search("garden report", now: now) }
    }

    func testSearchWithFilters() throws {
        // Linux release: 52 ms.
        try assertWithin(300, "search text + label + priority") { _ = try store.search("invoice #label3 !3", now: now) }
        // Linux release: 50 ms.
        try assertWithin(300, "search text + date range") { _ = try store.search("budget next week", now: now) }
        // Linux release: 53 ms.
        try assertWithin(300, "search filters only") { _ = try store.search("#label5 !4", now: now) }
    }

    // MARK: Boards and Gantt

    func testManualKanbanColumns() throws {
        let view = fixture.manualBoardViewId
        // Linux release: 15 ms.
        try assertWithin(100, "kanban manual columns") { _ = try store.kanbanColumns(viewLocalId: view) }
    }

    func testManualKanbanBoardWithLabels() throws {
        let view = fixture.manualBoardViewId
        // Linux release: 65 ms.
        try assertWithin(350, "kanban columns + labels (board screen)") {
            let columns = try store.kanbanColumns(viewLocalId: view)
            _ = try store.attachRowData(columns.flatMap(\.tasks))
        }
    }

    func testFilterKanbanColumns() throws {
        let view = fixture.filterBoardViewId
        // Linux release: 12 ms.
        try assertWithin(100, "kanban filter columns") { _ = try store.kanbanColumns(viewLocalId: view) }
    }

    func testGanttTree() throws {
        let project = fixture.bigProjectId
        // Linux release: 156 ms.
        try assertWithin(800, "gantt data (big project)") { _ = try store.ganttData(projectLocalId: project, includeDone: true) }
        let tasks = try store.tasks(matching: TaskQuery(projectLocalId: project, includeDone: true))
        let children = try store.subtaskMap(projectLocalId: project)
        // Linux release: 146 ms.
        try assertWithin(750, "gantt tree build only") { _ = GanttTree.build(tasks: tasks, childMap: children) }
    }

    // MARK: Reminders

    func testUpcomingReminders() throws {
        // Linux release: 15 ms.
        try assertWithin(75, "upcoming reminders") { _ = try store.upcomingReminders(after: now, limit: 64) }
    }

    // MARK: Observation

    /// What `SmartViewScreen` reads on every task, label or project change: the groups plus each shown subtask's parent.
    private func todayRead(_ reading: CriaStore) throws -> (groups: [TaskGroup], parents: [String: String]) {
        let groups = try reading.smartGroups(.today, now: now)
        let items = groups.flatMap(\.items)
        let titles = Dictionary(items.map { ($0.task.localId, $0.task.title) }, uniquingKeysWith: { first, _ in first })
        var parents: [String: String] = [:]
        for (parent, kids) in try reading.subtaskMap() {
            for kid in kids where titles[kid] != nil && parents[kid] == nil {
                if let title = try titles[parent] ?? reading.task(localId: parent)?.title { parents[kid] = title }
            }
        }
        return (groups, parents)
    }

    func testTodayObservationRead() throws {
        // Linux release: 458 ms.
        try assertWithin(2_300, "today observation read") { _ = try todayRead(store) }
    }

    func testObserveStoreDeliversTheNextValueQuickly() async throws {
        let reading = store
        let stream = observeStore(reading, kinds: [.tasks]) { try $0.smartGroups(.today, now: PerfFixture.now).count }
        var iterator = stream.makeAsyncIterator()
        let first = await iterator.next()
        let start = DispatchTime.now().uptimeNanoseconds
        reading.bus.notify(.tasks)
        let next = await iterator.next()
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
        XCTAssertNotNil(first)
        XCTAssertEqual(next, first, "nothing changed, so the re-read gives the same groups")
        print("PERF observeStore change to value: \(String(format: "%.1f", elapsed)) ms")
        #if !DEBUG
        // Linux release: 399 ms, almost all of it the Today read itself.
        XCTAssertLessThan(elapsed, 2_000)
        #endif
    }
}
