import Foundation
import GRDB

/// Layout constants for the Gantt chart, mirroring Vikunja's values. Widths are points.
public enum GanttMetrics {
    public static let dayWidth: Double = 44
    public static let weekZoomDayWidth: Double = 16
    public static let rowHeight: Double = 40
    public static let headerHeight: Double = 56
    public static let dragThreshold: Double = 5
    /// Width in days of a bar with only one of start or end, or a dateless task's placeholder.
    public static let defaultSpanDays = 7
}

/// One row of the Gantt tree: a task with its indent level and effective day range. Ported from `GanttTaskNode`.
public struct GanttNode: Equatable, Sendable {
    public var taskLocalId: String
    public var title = ""
    public var done = false
    public var hexColor: String?
    /// Tree depth, capped at 4.
    public var indentLevel = 0
    public var childIds: [String] = []
    /// The task's own dates widened to cover descendants.
    public var startDay: Int?
    public var endDay: Int?
    public var hasOwnDates = true
    /// The range came purely from children.
    public var hasDerivedDates = false

    public var isParent: Bool { !childIds.isEmpty }
}

/// A dependency arrow: `from` blocks or precedes `to`.
public struct GanttEdge: Equatable, Sendable {
    public enum Kind: String, Sendable {
        case blocking, precedes
    }

    public let fromLocalId: String
    public let toLocalId: String
    public let kind: Kind
}

/// A day span, possibly derived from children.
struct DaySpan: Equatable {
    var start: Int?
    var end: Int?
    var derived = false
}

/// Effective day spans with memoisation and a cycle guard.
struct SpanResolver {
    let tasks: [String: TaskRecord]
    let childMap: [String: [String]]
    private var memo: [String: DaySpan] = [:]

    init(tasks: [String: TaskRecord], childMap: [String: [String]]) {
        self.tasks = tasks
        self.childMap = childMap
    }

    static func ownSpan(_ task: TaskRecord) -> (span: DaySpan, hasOwn: Bool) {
        let start = GanttTree.day(fromISO: task.startDate)
        // No end date: fall back to the due date so a task draws through its deadline.
        let end = GanttTree.day(fromISO: task.endDate) ?? GanttTree.day(fromISO: task.dueDate)
        return (DaySpan(start: start, end: end), start != nil || end != nil)
    }

    mutating func effective(_ taskId: String, seen: inout Set<String>) -> DaySpan {
        if let cached = memo[taskId] { return cached }
        guard !seen.contains(taskId), let task = tasks[taskId] else { return DaySpan() }
        seen.insert(taskId)
        let own = SpanResolver.ownSpan(task)
        var result = own.span
        var fromChild = false
        for kid in childMap[taskId] ?? [] where tasks[kid] != nil {
            let child = effective(kid, seen: &seen)
            if let childStart = child.start { result.start = min(result.start ?? childStart, childStart) }
            if let childEnd = child.end { result.end = max(result.end ?? childEnd, childEnd) }
            if child.start != nil || child.end != nil { fromChild = true }
        }
        seen.remove(taskId)
        result.derived = !own.hasOwn && fromChild
        memo[taskId] = result
        return result
    }
}

/// Ported from `buildGanttTaskTree.ts`. Dates are integer day numbers (UTC midnight days since the epoch) so
/// pixel maths never shifts with the time zone.
public enum GanttTree {
    /// ISO timestamp to UTC day number, nil for empty or invalid input.
    /// All-day values (UTC midnight) keep the day that was picked; timed values fall on the local day, so a task due at
    /// 22:00 in New York is not drawn on the next day.
    public static func day(fromISO iso: String?, calendar: Calendar = .cria) -> Int? {
        guard let iso, let date = DueDates.parse(iso) else { return nil }
        if DueDates.hasTimeOfDay(iso) { return localDay(of: date, calendar: calendar) }
        return Int((date.timeIntervalSince1970 / 86_400).rounded(.down))
    }

    /// The calendar day `date` falls on in the user's time zone, as a UTC day number like the rest of the Gantt maths.
    public static func localDay(of date: Date, calendar: Calendar = .cria) -> Int {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let midnight = utc.date(from: parts) ?? date
        return Int((midnight.timeIntervalSince1970 / 86_400).rounded(.down))
    }

    /// Day number to a midnight-UTC ISO string, Vikunja's date convention.
    public static func iso(fromDay day: Int) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date(timeIntervalSince1970: Double(day) * 86_400))
    }

    /// `yyyy-MM-dd` for a day number.
    public static func dayText(_ day: Int) -> String {
        String(iso(fromDay: day).prefix(10))
    }

    /// Depth-first nodes. A child whose parent is absent from `tasks` becomes a root.
    public static func build(tasks: [TaskRecord], childMap: [String: [String]]) -> [GanttNode] {
        let byId = Dictionary(tasks.map { ($0.localId, $0) }, uniquingKeysWith: { first, _ in first })
        var childSet = Set<String>()
        for (parentId, kids) in childMap where byId[parentId] != nil {
            for kid in kids where byId[kid] != nil { childSet.insert(kid) }
        }
        var resolver = SpanResolver(tasks: byId, childMap: childMap)
        var nodes: [GanttNode] = []
        for task in tasks where !childSet.contains(task.localId) {
            appendNode(task, indent: 0, path: [], byId: byId, resolver: &resolver, into: &nodes)
        }
        return nodes
    }

    private static func appendNode(
        _ task: TaskRecord, indent: Int, path: Set<String>, byId: [String: TaskRecord], resolver: inout SpanResolver,
        into nodes: inout [GanttNode]
    ) {
        // A subtask cycle (A is B's parent and B is A's) would otherwise recurse until the stack overflows.
        var path = path
        guard path.insert(task.localId).inserted else { return }
        let kids = (resolver.childMap[task.localId] ?? []).filter { byId[$0] != nil }
        var seen = Set<String>()
        let span = resolver.effective(task.localId, seen: &seen)
        nodes.append(GanttNode(
            taskLocalId: task.localId, title: task.title, done: task.done, hexColor: task.hexColor,
            indentLevel: min(indent, 4), childIds: kids, startDay: span.start, endDay: span.end,
            hasOwnDates: SpanResolver.ownSpan(task).hasOwn, hasDerivedDates: span.derived
        ))
        for kid in kids {
            if let child = byId[kid] {
                appendNode(child, indent: indent + 1, path: path, byId: byId, resolver: &resolver, into: &nodes)
            }
        }
    }

    /// What is drawn: descendants of a collapsed node are hidden, and with `showDateless` off so are dateless
    /// tasks and their subtrees.
    public static func visible(_ nodes: [GanttNode], collapsed: Set<String>, showDateless: Bool) -> [GanttNode] {
        var result: [GanttNode] = []
        var hideDepth: Int?
        for node in nodes {
            if let depth = hideDepth, node.indentLevel > depth { continue }
            hideDepth = nil
            if !showDateless && node.startDay == nil && node.endDay == nil {
                hideDepth = node.indentLevel
                continue
            }
            result.append(node)
            if collapsed.contains(node.taskLocalId) { hideDepth = node.indentLevel }
        }
        return result
    }

    /// Reorders top-level rows to follow `rootOrder`, carrying each root's subtree along. Roots missing from the
    /// order keep their relative position at the end.
    public static func reorderRootBlocks(_ nodes: [GanttNode], rootOrder: [String]) -> [GanttNode] {
        var blocks: [String: [GanttNode]] = [:]
        var original: [String] = []
        var current: String?
        for node in nodes {
            if node.indentLevel == 0 {
                current = node.taskLocalId
                blocks[node.taskLocalId] = [node]
                original.append(node.taskLocalId)
            } else if let key = current {
                blocks[key, default: []].append(node)
            }
        }
        var output: [GanttNode] = []
        var seen = Set<String>()
        for rootId in rootOrder {
            guard let block = blocks[rootId], !seen.contains(rootId) else { continue }
            output.append(contentsOf: block)
            seen.insert(rootId)
        }
        for rootId in original where !seen.contains(rootId) {
            output.append(contentsOf: blocks[rootId] ?? [])
        }
        return output
    }

    /// Child local id to parent local id.
    public static func parentMap(_ nodes: [GanttNode]) -> [String: String] {
        var result: [String: String] = [:]
        for node in nodes {
            for kid in node.childIds { result[kid] = node.taskLocalId }
        }
        return result
    }

    /// Where a relation arrow endpoint anchors: the task's own row when visible, else its nearest collapsed
    /// visible ancestor, else nil (the arrow is dropped).
    public static func visibleAnchor(
        of localId: String, visibleIds: Set<String>, parents: [String: String], collapsed: Set<String>
    ) -> String? {
        if visibleIds.contains(localId) { return localId }
        var seen = Set<String>()
        var current = parents[localId]
        while let ancestor = current, !seen.contains(ancestor) {
            seen.insert(ancestor)
            if visibleIds.contains(ancestor) { return collapsed.contains(ancestor) ? ancestor : nil }
            current = parents[ancestor]
        }
        return nil
    }
}

extension CriaStore {
    /// Parent to child local ids from subtask relations within a project.
    public func subtaskMap(projectLocalId: String) throws -> [String: [String]] {
        try database.writer.read { connection in
            let rows = try Row.fetchAll(connection, sql: """
                SELECT r.task_local_id, r.other_task_local_id FROM task_relations r
                  JOIN tasks t ON t.local_id = r.task_local_id
                 WHERE r.relation_kind = 'subtask' AND t.project_local_id = ? AND t.deleted = 0
                 ORDER BY r.created_at ASC
                """, arguments: [projectLocalId])
            var map: [String: [String]] = [:]
            for row in rows {
                let parent: String = row["task_local_id"]
                let child: String? = row["other_task_local_id"]
                if let child { map[parent, default: []].append(child) }
            }
            return map
        }
    }

    /// Blocking and precedes edges whose source is in the project, in source to target order.
    public func ganttEdges(projectLocalId: String) throws -> [GanttEdge] {
        try database.writer.read { connection in
            let rows = try Row.fetchAll(connection, sql: """
                SELECT r.task_local_id, r.other_task_local_id, r.relation_kind FROM task_relations r
                  JOIN tasks t ON t.local_id = r.task_local_id
                 WHERE r.relation_kind IN ('blocking', 'precedes') AND t.project_local_id = ? AND t.deleted = 0
                 ORDER BY r.created_at ASC
                """, arguments: [projectLocalId])
            return rows.compactMap { row in
                let kind: String = row["relation_kind"]
                let target: String? = row["other_task_local_id"]
                guard let target, let edgeKind = GanttEdge.Kind(rawValue: kind) else { return nil }
                return GanttEdge(fromLocalId: row["task_local_id"], toLocalId: target, kind: edgeKind)
            }
        }
    }
}
