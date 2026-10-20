import Foundation

/// Everything the Gantt screen draws for a project.
public struct GanttData: Equatable, Sendable {
    public let nodes: [GanttNode]
    public let edges: [GanttEdge]

    public init(nodes: [GanttNode], edges: [GanttEdge]) {
        self.nodes = nodes
        self.edges = edges
    }

    /// The visible day range: every drawn date plus today, padded, and at least `minimumDays` wide.
    public func dayRange(today: Int, minimumDays: Int = 42) -> GanttDayRange {
        let days = nodes.flatMap { [$0.startDay, $0.endDay] }.compactMap { $0 } + [today]
        let low = (days.min() ?? today) - 7
        let high = max((days.max() ?? today) + 14, low + minimumDays - 1)
        return GanttDayRange(today: today, low: low, high: high)
    }
}

extension CriaStore {
    /// The project's task tree and dependency edges. Completed tasks can be left out.
    public func ganttData(projectLocalId: String, includeDone: Bool) throws -> GanttData {
        let tasks = try self.tasks(matching: TaskQuery(projectLocalId: projectLocalId, includeDone: includeDone))
        // Subtasks follow the order of the list (task position), so a row reorder in the chart sticks. A child the
        // list does not hold (a filtered-out done task) sorts last, and the sort keeps the relation order otherwise.
        let rank = Dictionary(tasks.enumerated().map { ($1.localId, $0) }, uniquingKeysWith: { first, _ in first })
        let childMap = try subtaskMap(projectLocalId: projectLocalId).mapValues { kids in
            kids.enumerated().sorted { lhs, rhs in
                let (left, right) = (rank[lhs.element] ?? Int.max, rank[rhs.element] ?? Int.max)
                return left == right ? lhs.offset < rhs.offset : left < right
            }.map(\.element)
        }
        let nodes = GanttTree.build(tasks: tasks, childMap: childMap)
        return GanttData(nodes: nodes, edges: try ganttEdges(projectLocalId: projectLocalId))
    }

    /// Writes new bar dates (day numbers) through `updateTask`, so they queue a push.
    @discardableResult
    public func setGanttDates(taskLocalId: String, start: Int, end: Int) throws -> TaskRecord {
        var patch = TaskPatch()
        patch.startDate = GanttTree.iso(fromDay: start)
        patch.endDate = GanttTree.iso(fromDay: end)
        return try updateTask(localId: taskLocalId, patch: patch)
    }

    /// `setGanttDates`, plus the step that restores the bar's old dates.
    @discardableResult
    public func setGanttDatesUndoable(taskLocalId: String, start: Int, end: Int) throws -> TaskUndoStep {
        var patch = TaskPatch()
        patch.startDate = GanttTree.iso(fromDay: start)
        patch.endDate = GanttTree.iso(fromDay: end)
        return try updateTaskUndoable(localId: taskLocalId, patch: patch, message: "Dates changed")
    }
}
