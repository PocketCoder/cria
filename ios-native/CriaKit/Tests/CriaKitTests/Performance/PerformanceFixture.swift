import Foundation
import GRDB
import XCTest
@testable import CriaKit

/// Deterministic pseudo-random numbers (SplitMix64), so every run builds the same dataset.
struct FixtureRandom: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var mixed = state
        mixed = (mixed ^ (mixed >> 30)) &* 0xBF58_476D_1CE4_E5B9
        mixed = (mixed ^ (mixed >> 27)) &* 0x94D0_49BB_1331_11EB
        return mixed ^ (mixed >> 31)
    }
}

/// A realistic account: about 5,000 tasks over 30 projects, with labels, subtasks, reminders, comments and boards.
/// Built with direct SQL in one transaction (a few hundred milliseconds), so each performance test starts from the same data.
struct PerfFixture: Sendable {
    /// The instant "now" means in every timing test: dates are spread around it.
    static let now = Date(timeIntervalSince1970: 1_791_795_600)  // 2026-10-12 09:00 UTC
    static let vocabulary = [
        "invoice", "garden", "report", "meeting", "budget", "holiday", "review", "plumber", "birthday", "tax",
        "website", "groceries", "dentist", "passport", "backup", "presentation", "contract", "renew", "repair", "email"
    ]

    let store: CriaStore
    let taskCount: Int
    let projectIds: [String]
    /// The project with the most tasks, and one with a board and a Gantt chart.
    let bigProjectId: String
    let boardProjectId: String
    let manualBoardViewId: String
    let filterBoardViewId: String
    let labelTitles: [String]
}

/// Counts the SQL statements a body runs, to catch per-row queries (N+1) without relying on timing. Only the app's own
/// statements count: SQLite traces the ones FTS5 runs on its shadow tables too (prefixed `--`), and those grow with the
/// number of matches by design.
final class StatementCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func record() { lock.withLock { count += 1 } }
    var value: Int { lock.withLock { count } }
    func reset() { lock.withLock { count = 0 } }
}

func makePerfStore(counter: StatementCounter? = nil) throws -> CriaStore {
    var configuration = Configuration()
    if let counter {
        configuration.prepareDatabase { connection in
            connection.trace { event in
                if !String(describing: event).hasPrefix("--") { counter.record() }
            }
        }
    }
    return CriaStore(database: try CriaDatabase(writer: DatabaseQueue(configuration: configuration)))
}

private func iso(_ date: Date) -> String { date.formatted(.iso8601) }

/// Seeds the dataset. `taskCount` scales everything else (labels per task, subtasks, comments) from the 5,000 baseline.
func makePerfFixture(taskCount: Int = 5_000, counter: StatementCounter? = nil) throws -> PerfFixture {
    let store = try makePerfStore(counter: counter)
    var random = FixtureRandom(seed: 91)
    let now = PerfFixture.now
    let stamp = iso(now)
    let projectTotal = 30
    let labelTotal = 40
    var projectIds: [String] = []
    var taskIds: [String] = []
    var big = ""
    var board = ""
    var manualView = ""
    var filterView = ""
    let labelTitles = (1...labelTotal).map { "label\($0)" }

    try store.database.writer.write { connection in
        // 30 projects: 8 top-level, the rest nested one or two levels down. Two are archived.
        for index in 0..<projectTotal {
            let localId = "p-\(UUID().uuidString)"
            let parent: String? = index < 8 ? nil : projectIds[index % 8 + (index > 20 ? 8 : 0)]
            try connection.execute(sql: """
                INSERT INTO projects (local_id, server_id, title, parent_local_id, is_archived, position, updated_at, dirty, deleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
                """, arguments: [localId, index + 1, "Project \(index + 1)", parent, index == 11 || index == 27 ? 1 : 0,
                                 Double(index) * 1024, stamp])
            projectIds.append(localId)
        }
        for (index, title) in labelTitles.enumerated() {
            try connection.execute(sql: """
                INSERT INTO labels (local_id, server_id, title, hex_color, updated_at, dirty, deleted)
                VALUES (?, ?, ?, ?, ?, 0, 0)
                """, arguments: ["l-\(index)", index + 1, title, "ff8800", stamp])
        }
        big = projectIds[0]
        board = projectIds[1]
        taskIds = try seedTasks(connection, count: taskCount, projectIds: projectIds, now: now, stamp: stamp, random: &random)
        try seedTaskLabels(connection, taskIds: taskIds, labelTotal: labelTotal, stamp: stamp, random: &random)
        try seedRelationsAndReminders(connection, taskIds: taskIds, now: now, stamp: stamp, random: &random)
        try seedComments(connection, taskIds: taskIds, stamp: stamp)
        (manualView, filterView) = try seedViews(connection, projectIds: projectIds, board: board, stamp: stamp)
    }
    return PerfFixture(
        store: store, taskCount: taskCount, projectIds: projectIds, bigProjectId: big, boardProjectId: board,
        manualBoardViewId: manualView, filterBoardViewId: filterView, labelTitles: labelTitles
    )
}

extension PerfFixture {
    /// The saved filters in the dataset: a date range, a priority, labels, a project and a combination.
    static let savedFilterQueries = [
        "dueDate < now && done = false",
        "priority >= 3 && done = false",
        "labels in label3, label7, label11",
        "project = 2 && done = false",
        "(priority >= 4 || dueDate > now+7d) && labels = label5"
    ]
}

/// Median wall-clock milliseconds of `body` over `runs` runs after one warm-up, printed as a `PERF` line so the
/// numbers show in the test log. Used instead of `measure` so budgets are explicit assertions.
@discardableResult
func timed(_ label: String, runs: Int = 5, _ body: () throws -> Void) rethrows -> Double {
    try body()
    var samples: [Double] = []
    for _ in 0..<runs {
        let start = DispatchTime.now().uptimeNanoseconds
        try body()
        samples.append(Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
    }
    let median = samples.sorted()[samples.count / 2]
    print("PERF \(label): \(String(format: "%.1f", median)) ms")
    return median
}

/// The fixture's subtask and blocking relations, and reminders on a tenth of the tasks.
private func seedRelationsAndReminders(
    _ connection: Database, taskIds: [String], now: Date, stamp: String, random: inout FixtureRandom
) throws {
    let taskCount = taskIds.count
    // About 300 subtask relations (parent and inverse), each child in the parent's project.
    let subtaskTotal = taskCount * 6 / 100
    for number in 0..<subtaskTotal {
        let parent = taskIds[number * 13 % taskCount]
        let child = taskIds[(number * 13 + 7) % taskCount]
        guard parent != child else { continue }
        for (source, target, kind) in [(parent, child, "subtask"), (child, parent, "parenttask")] {
            try connection.execute(sql: """
                INSERT OR IGNORE INTO task_relations (task_local_id, other_task_local_id, relation_kind, created_at)
                VALUES (?, ?, ?, ?)
                """, arguments: [source, target, kind, stamp])
        }
        if number % 5 == 0 {
            try connection.execute(sql: """
                INSERT OR IGNORE INTO task_relations (task_local_id, other_task_local_id, relation_kind, created_at)
                VALUES (?, ?, 'blocking', ?)
                """, arguments: [parent, taskIds[(number * 31 + 3) % taskCount], stamp])
        }
    }
    // Reminders on a tenth of the tasks, some in the past, some with a server offset, some relative.
    for number in stride(from: 0, to: taskCount, by: 10) {
        let fireAt = now.addingTimeInterval(Double(Int.random(in: -30...60, using: &random)) * 86_400 + Double(number % 86_400))
        let text = number % 3 == 0 ? iso(fireAt).replacingOccurrences(of: "Z", with: "+02:00") : iso(fireAt)
        try connection.execute(sql: """
            INSERT OR IGNORE INTO task_reminders (task_local_id, reminder_at, relative_period, relative_to, notified)
            VALUES (?, ?, ?, ?, ?)
            """, arguments: [taskIds[number], text, number % 4 == 0 ? -3_600 : nil, number % 4 == 0 ? "due_date" : nil,
                             fireAt < now ? 1 : 0])
    }
}

/// Views and buckets for the first four projects; the second (`board`) gets a manual board and a filter board.
private func seedViews(_ connection: Database, projectIds: [String], board: String, stamp: String) throws -> (String, String) {
    // Views and buckets for the first four projects. The second has a manual board and a filter board.
    for (index, project) in projectIds.prefix(4).enumerated() {
        for (kind, position) in [("list", 100.0), ("gantt", 200), ("table", 300), ("kanban", 400)] {
            let view = "v-\(index)-\(kind)"
            try connection.execute(sql: """
                INSERT INTO project_views (local_id, server_id, project_local_id, title, view_kind, position, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, arguments: [view, index * 10 + Int(position / 100), project, kind.capitalized, kind, position, stamp])
        }
    }
    let manualView = "v-1-kanban"
    let buckets = (0..<5).map { "b-\($0)" }
    for (index, bucket) in buckets.enumerated() {
        try connection.execute(sql: """
            INSERT INTO buckets (local_id, server_id, view_local_id, title, position, task_limit, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, ?)
            """, arguments: [bucket, 500 + index, manualView, "Bucket \(index)", Double(index) * 1024, stamp])
    }
    try connection.execute(
        sql: "UPDATE project_views SET default_bucket_server_id = 500, done_bucket_server_id = 504 WHERE local_id = ?",
        arguments: [manualView]
    )
    try connection.execute(sql: """
        INSERT INTO task_buckets (task_local_id, view_local_id, bucket_local_id, position)
        SELECT local_id, ?, 'b-' || (abs(random()) % 5), position FROM tasks WHERE project_local_id = ? AND done = 0
        """, arguments: [manualView, board])
    let filterView = "v-filter"
    let config = """
        [{"title":"Overdue","filter":{"filter":"dueDate < now && done = false","filter_include_nulls":false}},
         {"title":"Urgent","filter":{"filter":"priority >= 4","filter_include_nulls":false}},
         {"title":"Labelled","filter":{"filter":"labels in label3, label7","filter_include_nulls":false}},
         {"title":"Done","filter":{"filter":"done = true","filter_include_nulls":false}}]
        """
    try connection.execute(sql: """
        INSERT INTO project_views (local_id, server_id, project_local_id, title, view_kind, position,
               bucket_configuration_mode, bucket_configuration, updated_at)
        VALUES (?, 99, ?, 'Filters', 'kanban', 500, 'filter', ?, ?)
        """, arguments: [filterView, board, config, stamp])
    for (index, query) in PerfFixture.savedFilterQueries.enumerated() {
        try connection.execute(sql: """
            INSERT INTO saved_filters (server_id, title, filter_query, filter_include_nulls, updated_at) VALUES (?, ?, ?, 0, ?)
            """, arguments: [index + 1, "Filter \(index + 1)", query, stamp])
    }
    return (manualView, filterView)
}

/// Tasks spread over the projects with skewed sizes: a few big projects, many small ones, like a real account.
private func seedTasks(
    _ connection: Database, count taskCount: Int, projectIds: [String], now: Date, stamp: String, random: inout FixtureRandom
) throws -> [String] {
    let projectTotal = projectIds.count
    var taskIds: [String] = []
    let weights = (0..<projectTotal).map { $0 < 3 ? 8 : ($0 < 10 ? 3 : 1) }
    let weightSum = weights.reduce(0, +)
    for number in 0..<taskCount {
        var pick = Int.random(in: 0..<weightSum, using: &random)
        var project = 0
        while pick >= weights[project] { pick -= weights[project]; project += 1 }
        let localId = "t-\(UUID().uuidString)"
        taskIds.append(localId)
        let done = Int.random(in: 0..<100, using: &random) < 35
        let words = (0..<3).map { _ in PerfFixture.vocabulary[Int.random(in: 0..<PerfFixture.vocabulary.count, using: &random)] }
        let title = "\(words.joined(separator: " ")) \(number)"
        let description = Int.random(in: 0..<10, using: &random) < 6 ? "<p>Notes about \(words[0]) and \(words[2]).</p>" : nil
        var due: String?
        if Int.random(in: 0..<100, using: &random) < 70 {
            let offset = Int.random(in: -365...365, using: &random)
            let day = now.addingTimeInterval(Double(offset) * 86_400)
            let midnight = Date(timeIntervalSince1970: (day.timeIntervalSince1970 / 86_400).rounded(.down) * 86_400)
            // About a quarter of the dated tasks carry a time of day.
            let timed = Int.random(in: 0..<4, using: &random) == 0
            due = iso(timed ? midnight.addingTimeInterval(Double(Int.random(in: 1...86_399, using: &random))) : midnight)
        }
        try connection.execute(sql: """
            INSERT INTO tasks (local_id, server_id, project_local_id, title, description, done, done_at, due_date,
                   start_date, priority, percent_done, position, is_favorite, is_subscribed, updated_at, created_at, dirty, deleted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, 0, 0)
            """, arguments: [
                localId, number + 1, projectIds[project], title, description, done, done ? stamp : nil, due,
                due != nil && number % 5 == 0 ? due : nil, Int.random(in: 0...5, using: &random),
                Double(number) * 64, Int.random(in: 0..<20, using: &random) == 0, stamp, stamp
            ])
    }
    return taskIds
}

private func seedTaskLabels(
    _ connection: Database, taskIds: [String], labelTotal: Int, stamp: String, random: inout FixtureRandom
) throws {
    let taskCount = taskIds.count
    // About 1.6 labels per task: a distinct pair each time.
    var pairs = Set<String>()
    while pairs.count < taskCount * 8 / 5 {
        let task = Int.random(in: 0..<taskCount, using: &random)
        let label = Int.random(in: 0..<labelTotal, using: &random)
        guard pairs.insert("\(task)/\(label)").inserted else { continue }
        try connection.execute(sql: """
            INSERT INTO task_labels (task_local_id, label_local_id, updated_at, dirty, deleted) VALUES (?, ?, ?, 0, 0)
            """, arguments: [taskIds[task], "l-\(label)", stamp])
    }
}

private func seedComments(_ connection: Database, taskIds: [String], stamp: String) throws {
    let taskCount = taskIds.count
    // Comments on a twentieth of the tasks, one to three each.
    var commentNumber = 0
    for number in stride(from: 0, to: taskCount, by: 20) {
        for _ in 0...(number % 3) {
            commentNumber += 1
            try connection.execute(sql: """
                INSERT INTO task_comments (local_id, server_id, task_local_id, comment, author_name, created_at, updated_at,
                       read, dirty, deleted) VALUES (?, ?, ?, ?, 'Sam', ?, ?, 1, 0, 0)
                """, arguments: ["c-\(commentNumber)", commentNumber, taskIds[number], "<p>Comment \(commentNumber)</p>", stamp, stamp])
        }
    }
}
