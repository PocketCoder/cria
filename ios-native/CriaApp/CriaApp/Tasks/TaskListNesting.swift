import CriaKit
import SwiftUI

/// How many of a task's subtasks are done.
struct SubtaskProgress: Equatable, Sendable {
    let done: Int
    let total: Int
}

/// A list's rows plus what nesting needs: the subtask map and each parent's progress.
struct TaskListSnapshot: Equatable, Sendable {
    var items: [TaskListItem] = []
    var children: [String: [String]] = [:]
    var progress: [String: SubtaskProgress] = [:]
    /// A subtask's parent title, shown when its parent is not in the list to nest under.
    var parentTitles: [String: String] = [:]
    /// Task local id to the user ids assigned, for the Display sheet's assignee filter.
    var assignees: [String: Set<Int>] = [:]
    /// False until the first read, so the list is not built empty and then filled while on screen.
    var loaded = false
}

/// Where a row sits in a list: its depth, its subtask progress and, when its children are nested under it, whether
/// they are collapsed. Lists that do not nest can name the parent instead.
struct TaskRowTree {
    var depth = 0
    var progress: SubtaskProgress?
    /// Nil when the row has no children in the list to collapse.
    var isCollapsed: Bool?
    var onToggleCollapsed: () -> Void = {}
    /// "Subtask of ‘Parent’" under the title, for lists that do not nest.
    var parentTitle: String?
    /// The row's place in the Mac's card around an expanded parent and its subtasks.
    var groupRole = TaskGroupRole.none
    /// The list has a parent somewhere, so every row keeps a gutter for the disclosure arrow and the rings line up.
    var reservesDisclosure = false
}

/// A row's place in the card the Mac draws around an expanded parent and its subtasks.
enum TaskGroupRole: Equatable {
    case none, head, middle, end
}

/// Each row's place in a parent-and-subtasks card, worked out once per list.
struct TaskGroupEdges: Equatable {
    var roles: [String: TaskGroupRole] = [:]
    /// Any row with children in the list, collapsed or not.
    var hasParents = false

    init() {}

    init(_ rows: [NestedTaskItem]) {
        for (index, row) in rows.enumerated() {
            if row.hasChildren { hasParents = true }
            let nextDepth = index + 1 < rows.count ? rows[index + 1].depth : 0
            if row.depth == 0 {
                if nextDepth > 0 { roles[row.id] = .head }
            } else {
                roles[row.id] = nextDepth == 0 ? .end : .middle
            }
        }
    }

    func role(_ id: String) -> TaskGroupRole { roles[id] ?? .none }
}

enum TaskListNesting {
    /// Indent per level of nesting, in points.
    static let indent: CGFloat = 20
    /// The Mac's indent: the ring's 24pt target and the 7pt gap, so a subtask's ring sits under its parent's title.
    static let macIndent: CGFloat = 31

    /// Reads the subtask map and each parent's progress for a list's items. Done flags come from the items; subtasks
    /// outside the list (another project) are looked up in one read, so the count still covers them.
    static func snapshot(_ reading: CriaStore, items: [TaskListItem]) throws -> TaskListSnapshot {
        let children = try reading.subtaskMap()
        let doneById = Dictionary(items.map { ($0.task.localId, $0.task.done) }, uniquingKeysWith: { first, _ in first })
        let parents = items.filter { !(children[$0.task.localId]?.isEmpty ?? true) }
        let outside = try reading.tasks(localIds: parents.flatMap { children[$0.task.localId] ?? [] }.filter { doneById[$0] == nil })
        var progress: [String: SubtaskProgress] = [:]
        for item in parents {
            var done = 0
            var total = 0
            for kid in Set(children[item.task.localId] ?? []) {
                guard let isDone = doneById[kid] ?? outside[kid]?.done else { continue }
                total += 1
                if isDone { done += 1 }
            }
            if total > 0 { progress[item.task.localId] = SubtaskProgress(done: done, total: total) }
        }
        return TaskListSnapshot(
            items: items, children: children, progress: progress,
            parentTitles: try parentTitles(reading, for: items, children: children), assignees: try reading.assigneeMap(),
            loaded: true
        )
    }

    /// A section's rows nested under their parents, with the descendants of collapsed parents left out.
    static func rows(_ items: [TaskListItem], children: [String: [String]], collapsed: Set<String>) -> [NestedTaskItem] {
        visible(TaskTree.nest(items, children: children), collapsed: collapsed)
    }

    /// Drops the descendants of collapsed parents.
    static func visible(_ rows: [NestedTaskItem], collapsed: Set<String>) -> [NestedTaskItem] {
        var hidingBelow: Int?
        return rows.filter { row in
            if let depth = hidingBelow {
                if row.depth > depth { return false }
                hidingBelow = nil
            }
            if row.hasChildren && collapsed.contains(row.id) { hidingBelow = row.depth }
            return true
        }
    }

    /// Each shown subtask's parent title, for the caption in lists that do not nest (Today, Upcoming, Search).
    /// Parents outside the list are looked up in one read. Pass `children` when the caller has already read the map.
    static func parentTitles(
        _ reading: CriaStore, for items: [TaskListItem], children: [String: [String]]? = nil
    ) throws -> [String: String] {
        let titles = Dictionary(items.map { ($0.task.localId, $0.task.title) }, uniquingKeysWith: { first, _ in first })
        let map = try children ?? reading.subtaskMap()
        let wanted = map.filter { parent, kids in
            titles[parent] == nil && kids.contains { titles[$0] != nil && $0 != parent }
        }
        let outside = try reading.tasks(localIds: wanted.keys)
        var result: [String: String] = [:]
        for (parent, kids) in map.sorted(by: { $0.key < $1.key }) {
            for kid in kids where titles[kid] != nil && result[kid] == nil && kid != parent {
                if let title = titles[parent] ?? outside[parent]?.title { result[kid] = title }
            }
        }
        return result
    }

    /// The row's tree context in a nested list.
    @MainActor static func tree(
        for row: NestedTaskItem, progress: [String: SubtaskProgress], collapsed: Binding<Set<String>>,
        parentTitles: [String: String] = [:], edges: TaskGroupEdges = TaskGroupEdges()
    ) -> TaskRowTree {
        let id = row.id
        return TaskRowTree(
            depth: row.depth,
            progress: progress[id],
            isCollapsed: row.hasChildren ? collapsed.wrappedValue.contains(id) : nil,
            onToggleCollapsed: {
                withAnimation(.snappy) {
                    if collapsed.wrappedValue.contains(id) {
                        collapsed.wrappedValue.remove(id)
                    } else {
                        collapsed.wrappedValue.insert(id)
                    }
                }
            },
            // Under its parent the caption would repeat what the indent already says.
            parentTitle: row.depth == 0 ? parentTitles[id] : nil,
            groupRole: edges.role(id),
            reservesDisclosure: edges.hasParents
        )
    }
}
