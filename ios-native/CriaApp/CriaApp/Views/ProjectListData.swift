import CriaKit
import Foundation

/// What a project's List view reads in one go: the task list, plus on the Mac every board's columns (for list sections)
/// and the info rail's figures, all worked out in the store read so nothing is computed in a body.
struct ProjectListData: Equatable, Sendable {
    var snapshot = TaskListSnapshot()
    /// The project's Kanban views, each with its columns. The List view groups by one of them only when the user has
    /// turned sections on for the project (`Customisation.listSections`); empty on iOS.
    var boards: [ProjectListBoard] = []
    var rail = ProjectRailSummary()

    static func read(_ reading: CriaStore, projectLocalId: String) throws -> ProjectListData {
        let items = try reading.taskItems(.project(projectLocalId), includeDone: true)
        var data = try ProjectListData(snapshot: TaskListNesting.snapshot(reading, items: items))
        #if os(macOS)
        for view in try reading.views(forProject: projectLocalId) where view.viewKind == .kanban {
            data.boards.append(try ProjectListBoard.read(reading, view: view))
        }
        data.rail = try ProjectRailSummary.make(reading, projectLocalId: projectLocalId, items: items)
        #endif
        return data
    }

    /// The board the user chose for this project's sections, if it still exists.
    func sectionsBoard(_ key: String?) -> ProjectListBoard? {
        guard let key else { return nil }
        return boards.first { $0.key == key }
    }
}

/// One Kanban view as a source of list sections.
struct ProjectListBoard: Equatable, Sendable {
    let viewLocalId: String
    let title: String
    /// `Customisation.iconKey` of the view: its server id, or `local:<local id>` before it syncs.
    let key: String
    /// The columns in board order.
    var columns: [ProjectListColumn] = []
    /// Task local id to the index of its column in `columns`.
    var columnOf: [String: Int] = [:]

    static func read(_ reading: CriaStore, view: ViewRecord) throws -> ProjectListBoard {
        var board = ProjectListBoard(
            viewLocalId: view.localId, title: view.title, key: Customisation.iconKey(serverId: view.serverId, localId: view.localId)
        )
        for (index, column) in try reading.kanbanColumns(viewLocalId: view.localId).enumerated() {
            // Vikunja's Done column holds done tasks, which the list keeps in its Completed group instead.
            let isDone = column.bucket.serverId != nil && column.bucket.serverId == view.doneBucketServerId
            board.columns.append(ProjectListColumn(
                viewLocalId: view.localId, bucketLocalId: column.bucket.localId, title: column.bucket.title,
                // "filter:" is CriaKit's internal `Kanban.filterBucketPrefix`: a filter-managed, read-only column.
                acceptsTasks: !column.bucket.localId.hasPrefix("filter:") && !column.atLimit && !isDone,
                isDone: isDone
            ))
            for task in column.tasks where board.columnOf[task.localId] == nil { board.columnOf[task.localId] = index }
        }
        return board
    }
}

/// One Kanban column as a List view section: "To-Do", "Doing" and so on.
struct ProjectListColumn: Equatable, Sendable {
    let viewLocalId: String
    let bucketLocalId: String
    let title: String
    /// False for a filter-managed, full or Done column: its section has no New Task row.
    let acceptsTasks: Bool
    /// The board's Done column: shown only when an open task sits in it.
    var isDone = false
}

/// The project info rail's figures (Mac only), computed once per store read.
struct ProjectRailSummary: Equatable, Sendable {
    var project: ProjectRecord?
    var total = 0
    var done = 0
    var overdue = 0
    /// The next three open tasks with a due date, soonest first.
    var comingUp: [TaskRecord] = []
    /// Each label on the project's tasks with how many carry it, most used first.
    var labels: [ProjectRailLabel] = []
    /// Everyone assigned to a task in the project, by name.
    var people: [AssigneeRecord] = []

    static func make(_ reading: CriaStore, projectLocalId: String, items: [TaskListItem]) throws -> ProjectRailSummary {
        var summary = ProjectRailSummary(project: try reading.project(localId: projectLocalId), total: items.count)
        let now = Date()
        var dated: [(TaskRecord, Date)] = []
        var counts: [String: ProjectRailLabel] = [:]
        for item in items {
            for label in item.labels { counts[label.localId, default: ProjectRailLabel(label: label, count: 0)].count += 1 }
            if item.task.done {
                summary.done += 1
                continue
            }
            guard let due = item.task.dueDate else { continue }
            if DueDates.isOverdue(due, now: now) { summary.overdue += 1 }
            if let date = DueDates.parse(due) { dated.append((item.task, date)) }
        }
        summary.comingUp = dated.sorted { $0.1 < $1.1 }.prefix(3).map(\.0)
        summary.labels = counts.values.sorted { $0.count != $1.count ? $0.count > $1.count : $0.label.title < $1.label.title }
        var seen = Set<Int>()
        summary.people = try reading.assigneesByTask(projectLocalId: projectLocalId).values
            .flatMap { $0 }
            .filter { seen.insert($0.userId).inserted }
            .sorted { personName($0).localizedCaseInsensitiveCompare(personName($1)) == .orderedAscending }
        return summary
    }

    /// A person's display name, else their username.
    static func personName(_ person: AssigneeRecord) -> String {
        person.displayName ?? person.username ?? "User \(person.userId)"
    }
}

/// A label on the project's tasks and how many carry it.
struct ProjectRailLabel: Equatable, Sendable {
    let label: LabelRecord
    var count: Int
}
