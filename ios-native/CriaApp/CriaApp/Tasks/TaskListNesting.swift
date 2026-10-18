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
}

enum TaskListNesting {
    /// Indent per level of nesting, in points.
    static let indent: CGFloat = 20

    /// Reads the subtask map and each parent's progress for a list's items. Done flags come from the items; a
    /// subtask outside the list (another project) is looked up on its own, so the count still covers it.
    static func snapshot(_ reading: CriaStore, items: [TaskListItem]) throws -> TaskListSnapshot {
        let children = try reading.subtaskMap()
        let doneById = Dictionary(items.map { ($0.task.localId, $0.task.done) }, uniquingKeysWith: { first, _ in first })
        var progress: [String: SubtaskProgress] = [:]
        for item in items {
            guard let kids = children[item.task.localId], !kids.isEmpty else { continue }
            var done = 0
            var total = 0
            for kid in Set(kids) {
                let isDone: Bool?
                if let known = doneById[kid] {
                    isDone = known
                } else {
                    isDone = try reading.task(localId: kid)?.done
                }
                guard let isDone else { continue }
                total += 1
                if isDone { done += 1 }
            }
            if total > 0 { progress[item.task.localId] = SubtaskProgress(done: done, total: total) }
        }
        return TaskListSnapshot(
            items: items, children: children, progress: progress, assignees: try reading.assigneeMap(), loaded: true
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
    /// A parent outside the list is looked up once.
    static func parentTitles(_ reading: CriaStore, for items: [TaskListItem]) throws -> [String: String] {
        let titles = Dictionary(items.map { ($0.task.localId, $0.task.title) }, uniquingKeysWith: { first, _ in first })
        var result: [String: String] = [:]
        var looked: [String: String?] = [:]
        for (parent, kids) in try reading.subtaskMap().sorted(by: { $0.key < $1.key }) {
            for kid in kids where titles[kid] != nil && result[kid] == nil && kid != parent {
                let title: String?
                if let known = titles[parent] {
                    title = known
                } else if let cached = looked[parent] {
                    title = cached
                } else {
                    title = try reading.task(localId: parent)?.title
                    looked.updateValue(title, forKey: parent)
                }
                if let title { result[kid] = title }
            }
        }
        return result
    }

    /// The row's tree context in a nested list.
    @MainActor static func tree(
        for row: NestedTaskItem, progress: [String: SubtaskProgress], collapsed: Binding<Set<String>>
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
            }
        )
    }
}
