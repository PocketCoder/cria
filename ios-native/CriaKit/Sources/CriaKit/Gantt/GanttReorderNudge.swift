import Foundation

/// Which edge of a bar a keyboard nudge changes.
public enum GanttNudgeEdge: Equatable, Sendable {
    case both, start, end
}

extension GanttGeometry {
    /// A one-day keyboard nudge of a bar (`direction` is -1 or 1): both edges move, or only the start or the end,
    /// which never cross. Nil for a dateless placeholder or no direction. Ported from `nudgeBar`.
    public static func nudge(_ days: GanttDays, direction: Int, edge: GanttNudgeEdge) -> (start: Int, end: Int)? {
        guard direction != 0, !days.dateless else { return nil }
        switch edge {
        case .end: return (days.start, max(days.start, days.end + direction))
        case .start: return (min(days.end, days.start + direction), days.end)
        case .both: return (days.start + direction, days.end + direction)
        }
    }
}

extension GanttTree {
    /// The top-level order after dragging a root's row by `rowOffset` rows (negative is up). Only roots reorder;
    /// the dragged root lands where the row it is dropped on belongs, with subtrees riding along. Nil when
    /// the moved id is not a root or the order does not change.
    public static func rootOrder(afterMoving movedId: String, rowOffset: Int, in nodes: [GanttNode]) -> [String]? {
        var roots: [(id: String, row: Int)] = []
        for (row, node) in nodes.enumerated() where node.indentLevel == 0 { roots.append((node.taskLocalId, row)) }
        guard let from = roots.firstIndex(where: { $0.id == movedId }), !nodes.isEmpty else { return nil }
        let target = min(max(roots[from].row + rowOffset, 0), nodes.count - 1)
        let destination = roots.lastIndex { $0.row <= target } ?? 0
        guard destination != from else { return nil }
        var ids = roots.map(\.id)
        ids.remove(at: from)
        ids.insert(movedId, at: destination)
        return ids
    }

    /// The ids of `parentId`'s direct children (the top-level rows when nil) among `nodes`, in row order.
    public static func siblingIds(of parentId: String?, in nodes: [GanttNode]) -> [String] {
        guard let range = childRange(of: parentId, in: nodes) else { return [] }
        let level = parentId == nil ? 0 : (nodes.first { $0.taskLocalId == parentId }?.indentLevel ?? 0) + 1
        return nodes[range].filter { $0.indentLevel == level }.map(\.taskLocalId)
    }

    /// The parent of the row `taskLocalId`: nil for a top-level row, or when it is not in `nodes`.
    public static func parentId(of taskLocalId: String, in nodes: [GanttNode]) -> String? {
        guard let index = nodes.firstIndex(where: { $0.taskLocalId == taskLocalId }), nodes[index].indentLevel > 0 else {
            return nil
        }
        let level = nodes[index].indentLevel
        return nodes[..<index].last { $0.indentLevel < level }?.taskLocalId
    }

    /// The order of a row's siblings after dragging its row by `rowOffset` rows (negative is up): the same rule as
    /// `rootOrder`, but among the children of the row's own parent only, so a subtask never leaves its parent.
    /// The row lands where the row it is dropped on belongs, subtrees riding along. Nil when the row is not in
    /// `nodes` or the order does not change.
    public static func siblingOrder(
        afterMoving movedId: String, rowOffset: Int, in nodes: [GanttNode]
    ) -> (parent: String?, order: [String])? {
        guard let movedRow = nodes.firstIndex(where: { $0.taskLocalId == movedId }) else { return nil }
        let parent = parentId(of: movedId, in: nodes)
        let level = nodes[movedRow].indentLevel
        guard let range = childRange(of: parent, in: nodes) else { return nil }
        let siblings = range.filter { nodes[$0].indentLevel == level }
        guard let from = siblings.firstIndex(of: movedRow) else { return nil }
        let target = min(max(movedRow + rowOffset, range.lowerBound), range.upperBound - 1)
        let destination = siblings.lastIndex { $0 <= target } ?? 0
        guard destination != from else { return nil }
        var ids = siblings.map { nodes[$0].taskLocalId }
        ids.remove(at: from)
        ids.insert(movedId, at: destination)
        return (parent, ids)
    }

    /// Reorders the children of `parentId` to follow `order`, each carrying its subtree. Children missing from the
    /// order keep their relative position at the end. A nil parent reorders the top-level rows.
    public static func reorderSiblingBlocks(_ nodes: [GanttNode], parent parentId: String?, order: [String]) -> [GanttNode] {
        guard let parentId else { return reorderRootBlocks(nodes, rootOrder: order) }
        guard let range = childRange(of: parentId, in: nodes),
              let parent = nodes.first(where: { $0.taskLocalId == parentId }) else { return nodes }
        let level = parent.indentLevel + 1
        var blocks: [String: [GanttNode]] = [:]
        var original: [String] = []
        var current: String?
        for node in nodes[range] {
            if node.indentLevel == level {
                current = node.taskLocalId
                blocks[node.taskLocalId] = [node]
                original.append(node.taskLocalId)
            } else if let key = current {
                blocks[key, default: []].append(node)
            }
        }
        var block: [GanttNode] = []
        var seen = Set<String>()
        for id in order where !seen.contains(id) {
            guard let rows = blocks[id] else { continue }
            block.append(contentsOf: rows)
            seen.insert(id)
        }
        for id in original where !seen.contains(id) { block.append(contentsOf: blocks[id] ?? []) }
        var result = nodes
        result.replaceSubrange(range, with: block)
        return result
    }

    /// The rows under `parentId` (every row when nil): from just after it to the next row that is not deeper.
    private static func childRange(of parentId: String?, in nodes: [GanttNode]) -> Range<Int>? {
        guard let parentId else { return nodes.indices }
        guard let index = nodes.firstIndex(where: { $0.taskLocalId == parentId }) else { return nil }
        let level = nodes[index].indentLevel
        var end = index + 1
        while end < nodes.count && nodes[end].indentLevel > level { end += 1 }
        return (index + 1)..<end
    }
}
