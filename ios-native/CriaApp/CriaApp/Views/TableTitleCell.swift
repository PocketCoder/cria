import CriaKit
import SwiftUI

extension TableGridView {
    /// The title cell: the title, a parent's subtask ring, and either an indent under a parent shown above it or a
    /// subtask's parent caption.
    func titleCell(_ task: TaskRecord) -> some View {
        let depth = depths[task.localId] ?? 0
        return NavigationLink(value: Route.task(task.localId)) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(task.title)
                        .font(Theme.rowTitle)
                        .strikethrough(task.done)
                        .foregroundStyle(task.done ? Color(.mutedForeground) : Color(.foreground))
                        .lineLimit(2)
                    if let progress = progress[task.localId] {
                        SubtaskRing(progress: progress).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                    }
                }
                if depth == 0, let parent = parentTitles[task.localId] {
                    Text("Subtask of ‘\(parent)’")
                        .font(Theme.caption)
                        .foregroundStyle(Color(.mutedForeground))
                        .lineLimit(1)
                }
            }
            .padding(.leading, CGFloat(depth) * 18)
        }
        .buttonStyle(.plain)
        .macPointer()
    }
}

/// Table rows in manual order with each subtask moved under its parent, when its parent is in the table too.
enum TableNesting {
    /// The rows with every subtask placed after its parent (and its parent's earlier subtasks), the rest kept in order.
    static func nested(_ rows: [TaskListItem], children: [String: [String]]) -> [TaskListItem] {
        let parentOf = parents(rows, children: children)
        guard !parentOf.isEmpty else { return rows }
        let byId = Dictionary(rows.map { ($0.task.localId, $0) }, uniquingKeysWith: { first, _ in first })
        var kids: [String: [String]] = [:]
        for row in rows {
            if let parent = parentOf[row.task.localId] { kids[parent, default: []].append(row.task.localId) }
        }
        var out: [TaskListItem] = []
        var seen = Set<String>()
        func visit(_ id: String) {
            guard !seen.contains(id), let item = byId[id] else { return }
            seen.insert(id)
            out.append(item)
            for kid in kids[id] ?? [] { visit(kid) }
        }
        for row in rows where parentOf[row.task.localId] == nil { visit(row.task.localId) }
        // A loop in the parent links leaves rows unvisited: they keep their place at the end.
        for row in rows { visit(row.task.localId) }
        return out
    }

    /// Each row's depth under a parent that comes before it in `rows`.
    static func depths(_ rows: [TaskListItem], children: [String: [String]]) -> [String: Int] {
        let parentOf = parents(rows, children: children)
        var depths: [String: Int] = [:]
        for row in rows {
            let id = row.task.localId
            if let parent = parentOf[id], let above = depths[parent] { depths[id] = above + 1 } else { depths[id] = 0 }
        }
        return depths
    }

    /// Subtask to parent, for pairs that are both in `rows`.
    private static func parents(_ rows: [TaskListItem], children: [String: [String]]) -> [String: String] {
        let present = Set(rows.map(\.task.localId))
        var parentOf: [String: String] = [:]
        for (parent, kids) in children where present.contains(parent) {
            for kid in kids where present.contains(kid) { parentOf[kid] = parent }
        }
        return parentOf
    }
}
