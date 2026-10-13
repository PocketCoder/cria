import Foundation
import GRDB

/// A task in a list with its nesting depth, for showing subtasks under their parent. Ported from
/// `src/features/tasks/taskTree.ts`.
public struct NestedTaskItem: Equatable, Sendable, Identifiable {
    public let item: TaskListItem
    public let depth: Int
    /// True when it has children in the same list.
    public let hasChildren: Bool
    public var id: String { item.task.localId }

    public init(item: TaskListItem, depth: Int, hasChildren: Bool) {
        self.item = item
        self.depth = depth
        self.hasChildren = hasChildren
    }
}

public enum TaskTree {
    /// Children are nested under their parent only when the parent is in the same list, so a subtask whose parent
    /// is filtered out (done, another project) still shows at the top level instead of vanishing. Roots keep the
    /// list's order; children follow their parent in list order. Depth is capped and cycles are cut.
    public static func nest(_ items: [TaskListItem], children: [String: [String]], maxDepth: Int = 4) -> [NestedTaskItem] {
        let byId = Dictionary(items.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        let order = Dictionary(items.enumerated().map { ($1.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        var childSet = Set<String>()
        for (parent, kids) in children where byId[parent] != nil {
            for kid in kids where byId[kid] != nil && kid != parent { childSet.insert(kid) }
        }
        var result: [NestedTaskItem] = []
        var placed = Set<String>()

        func visit(_ id: String, depth: Int) {
            guard let item = byId[id], placed.insert(id).inserted else { return }
            let kids = (children[id] ?? []).filter { byId[$0] != nil && !placed.contains($0) }
                .sorted { (order[$0] ?? 0) < (order[$1] ?? 0) }
            result.append(NestedTaskItem(item: item, depth: min(depth, maxDepth), hasChildren: !kids.isEmpty))
            for kid in kids { visit(kid, depth: depth + 1) }
        }

        for item in items where !childSet.contains(item.task.localId) { visit(item.task.localId, depth: 0) }
        // Anything left (only reachable through a cycle) still shows.
        for item in items where !placed.contains(item.task.localId) { visit(item.task.localId, depth: 0) }
        return result
    }
}

extension CriaStore {
    /// Parent local id to its subtasks' local ids, from the `subtask` relations stored locally.
    public func subtaskMap() throws -> [String: [String]] {
        try database.writer.read { connection in
            var map: [String: [String]] = [:]
            for row in try Row.fetchAll(connection, sql: """
                SELECT task_local_id, other_task_local_id FROM task_relations
                 WHERE relation_kind = 'subtask' AND other_task_local_id IS NOT NULL
                 ORDER BY created_at ASC
                """) {
                let parent: String = row["task_local_id"]
                let child: String = row["other_task_local_id"]
                map[parent, default: []].append(child)
            }
            return map
        }
    }
}
