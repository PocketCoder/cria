import CriaKit
import SwiftUI

extension SmartViewScreen {
    /// A row's tree context: depth, subtask progress, collapse state and its place in a subtask group.
    func tree(for row: NestedTaskItem, edges: TaskGroupEdges) -> TaskRowTree {
        let id = row.id
        return TaskRowTree(
            depth: row.depth,
            progress: live.value.nesting.progress[id],
            isCollapsed: row.hasChildren ? !expanded.contains(id) : nil,
            onToggleCollapsed: {
                withAnimation(.snappy) {
                    if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
                }
            },
            // Under its parent the caption would repeat what the indent already says.
            parentTitle: row.depth == 0 ? live.value.parentTitles[id] : nil,
            groupStart: edges.starts.contains(id),
            groupEnd: edges.ends.contains(id)
        )
    }
}
