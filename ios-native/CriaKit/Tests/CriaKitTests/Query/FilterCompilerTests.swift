import GRDB
import XCTest
@testable import CriaKit

/// Ports tests/unit/filterCompiler-project.test.ts (run against SQLite) plus string-level compiler checks.
final class FilterCompilerTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_783_598_400)

    private func seedTask(_ store: CriaStore, localId: String, project: String, title: String) throws {
        try store.database.writer.write { connection in
            try connection.execute(
                sql: """
                    INSERT INTO tasks (local_id, project_local_id, title, updated_at, dirty, deleted)
                    VALUES (?, ?, ?, ?, 0, 0)
                    """,
                arguments: [localId, project, title, isoNow()]
            )
        }
    }

    private func seededStore() throws -> CriaStore {
        let store = try makeStore()
        let work = try seedProject(store, serverId: 4, title: "Work")
        let home = try seedProject(store, serverId: 12, title: "Home")
        try seedTask(store, localId: "t1", project: work, title: "Work task")
        try seedTask(store, localId: "t2", project: home, title: "Home task")
        return store
    }

    private func run(_ store: CriaStore, _ query: String) throws -> [String] {
        let parsed = try parseFilterQuery(query, now: now)
        let compiled = try compileFilter(parsed.ast, includeNulls: false)
        return try store.database.writer.read { connection in
            try String.fetchAll(
                connection,
                sql: "SELECT title FROM tasks t WHERE t.deleted = 0 AND \(compiled.whereClause) ORDER BY title",
                arguments: compiled.arguments
            )
        }
    }

    private func compile(_ query: String, includeNulls: Bool = false) throws -> CompiledFilter {
        try compileFilter(try parseFilterQuery(query, now: now).ast, includeNulls: includeNulls)
    }

    func testProjectClauseMatchesNumericIdsAgainstServerId() throws {
        let store = try seededStore()
        XCTAssertEqual(try run(store, "project = 4"), ["Work task"])
        XCTAssertEqual(try run(store, "project in 4, 12"), ["Home task", "Work task"])
        XCTAssertEqual(try run(store, "project not in 4"), ["Home task"])
        XCTAssertEqual(try run(store, "project != 12"), ["Work task"])
    }

    func testProjectClauseStillMatchesStringsAgainstTitle() throws {
        let store = try seededStore()
        XCTAssertEqual(try run(store, "project = 'Work'"), ["Work task"])
        XCTAssertEqual(try run(store, "project in 'Work', 'Home'"), ["Home task", "Work task"])
    }

    func testNilAstCompilesToEmptyFilter() throws {
        let compiled = try compileFilter(nil, includeNulls: false)
        XCTAssertEqual(compiled.whereClause, "")
        XCTAssertEqual(compiled.params, [])
    }

    func testScalarAndGroupCompilation() throws {
        let single = try compile("priority >= 3")
        XCTAssertEqual(single.whereClause, "t.priority >= ?")
        XCTAssertEqual(single.params, [.integer(3)])

        let both = try compile("done = false && priority >= 3")
        XCTAssertEqual(both.whereClause, "(t.done = ? AND t.priority >= ?)")
        XCTAssertEqual(both.params, [.integer(0), .integer(3)])

        let either = try compile("priority = 1 || done = true")
        XCTAssertEqual(either.whereClause, "(t.priority = ? OR t.done = ?)")
        XCTAssertEqual(either.params, [.integer(1), .integer(1)])
    }

    func testIncludeNullsWrapsNonEqualityComparisons() throws {
        let compiled = try compile("dueDate < now", includeNulls: true)
        XCTAssertEqual(compiled.whereClause, "(t.due_date IS NULL OR t.due_date < ?)")
        XCTAssertEqual(compiled.params, [.text(QueryDates.isoString(now))])

        XCTAssertEqual(try compile("priority = 2", includeNulls: true).whereClause, "t.priority = ?")
        XCTAssertEqual(try compile("priority in 1, 2", includeNulls: true).whereClause, "(t.priority IS NULL OR t.priority IN (?, ?))")
    }

    func testLabelsAndAssigneesCompileToExistsSubqueries() throws {
        let labels = try compile("labels in urgent, home")
        XCTAssertEqual(labels.whereClause, """
            EXISTS (SELECT 1 FROM task_labels tl JOIN labels l ON l.local_id = tl.label_local_id \
            WHERE tl.task_local_id = t.local_id AND l.title IN (?, ?))
            """)
        XCTAssertEqual(labels.params, [.text("urgent"), .text("home")])

        let assignees = try compile("assignees != bob")
        XCTAssertEqual(assignees.whereClause, """
            NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_local_id = t.local_id AND ta.username = ?)
            """)
        XCTAssertEqual(assignees.params, [.text("bob")])
    }

    func testRemindersCompileAgainstTaskReminders() throws {
        let compiled = try compile("reminders > now")
        XCTAssertEqual(compiled.whereClause, """
            EXISTS (SELECT 1 FROM task_reminders tr WHERE tr.task_local_id = t.local_id AND tr.reminder > ?)
            """)
    }

    func testUnknownFieldThrows() throws {
        XCTAssertThrowsError(try compile("colour = red")) { error in
            XCTAssertEqual(error as? FilterCompileError, .unknownField("colour"))
        }
    }
}
