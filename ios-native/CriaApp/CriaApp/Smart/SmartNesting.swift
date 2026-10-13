import CriaKit
import SwiftUI

/// Subtasks under their parent in a list grouped by date (Today, Upcoming, Inbox, saved filters). A parent shows its
/// "2/5" chip; expanding it lists every subtask indented underneath, wherever their own dates put them. A subtask in
/// the same group as its parent sits only under the parent; elsewhere it stays in its own group with a "Subtask of"
/// caption.
struct SmartNestingData: Equatable, Sendable {
    var children: [String: [String]] = [:]
    /// Every subtask of a parent shown in the view, as list rows.
    var childItems: [String: TaskListItem] = [:]
    var progress: [String: SubtaskProgress] = [:]

    static func read(_ reading: CriaStore, items: [TaskListItem]) throws -> SmartNestingData {
        let children = try reading.subtaskMap()
        let shown = Set(items.map(\.task.localId))
        var wanted = Set<String>()
        for parent in shown { wanted.formUnion(children[parent] ?? []) }
        // Grandchildren too, so an expanded subtask can open in turn (two levels is plenty for a phone).
        for kid in wanted { wanted.formUnion(children[kid] ?? []) }
        let records = try wanted.sorted().compactMap { try reading.task(localId: $0) }
        let childItems = Dictionary(
            try reading.attachRowData(records).map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first }
        )
        var progress: [String: SubtaskProgress] = [:]
        for parent in shown.union(childItems.keys) {
            let kids = (children[parent] ?? []).compactMap { childItems[$0] }
            if !kids.isEmpty { progress[parent] = SubtaskProgress(done: kids.filter(\.task.done).count, total: kids.count) }
        }
        return SmartNestingData(children: children, childItems: childItems, progress: progress)
    }

    /// One group's rows: its top-level tasks, each followed by its subtasks when expanded.
    func rows(for items: [TaskListItem], expanded: Set<String>) -> [NestedTaskItem] {
        let inGroup = Set(items.map(\.task.localId))
        let nestedHere = Set(items.flatMap { children[$0.task.localId] ?? [] }).intersection(inGroup)
        var result: [NestedTaskItem] = []
        var placed = Set<String>()

        func add(_ item: TaskListItem, depth: Int) {
            guard placed.insert(item.task.localId).inserted else { return }
            let kids = (children[item.task.localId] ?? []).compactMap { childItems[$0] }
            result.append(NestedTaskItem(item: item, depth: depth, hasChildren: !kids.isEmpty))
            guard expanded.contains(item.task.localId), depth < 3 else { return }
            // Open subtasks first, then done ones.
            for kid in kids.filter({ !$0.task.done }) + kids.filter(\.task.done) { add(kid, depth: depth + 1) }
        }

        for item in items where !nestedHere.contains(item.task.localId) { add(item, depth: 0) }
        return result
    }
}
