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
}
