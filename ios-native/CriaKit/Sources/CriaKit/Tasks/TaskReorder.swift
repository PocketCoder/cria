import Foundation

/// A local drag order that wins over the stored order until the stored order changes. Ported from
/// `useOptimisticOrder.ts`: once the store re-emits a different list (the write landed or a sync arrived),
/// the stored order wins again, so no explicit clearing is needed.
public struct OptimisticOrder: Equatable, Sendable {
    private var base: [String] = []
    private var order: [String] = []

    public init() {}

    /// Records the dropped order against the stored order it was made from.
    public mutating func set(_ newOrder: [String], over storedOrder: [String]) {
        base = storedOrder
        order = newOrder
    }

    /// The order to render: the override while the stored order is unchanged, else the stored order.
    public func resolve(_ storedOrder: [String]) -> [String] {
        order.isEmpty || base != storedOrder ? storedOrder : order
    }
}

/// When list drag reorder is allowed. Positions only mean something in manual order with every task shown.
public enum ListReorder {
    public static func isEnabled(sort: SortRule?, hasFilter: Bool) -> Bool {
        guard !hasFilter else { return false }
        guard let sort else { return true }
        return sort.field == .userDefinedOrder && sort.direction == .asc
    }
}

extension CriaStore {
    /// The view whose id list reorders are recorded against: the project's list view, else its first view.
    public func listViewLocalId(projectLocalId: String) throws -> String? {
        let all = try views(forProject: projectLocalId)
        return (all.first { $0.viewKind == .list } ?? all.first)?.localId
    }

    /// Sets one task's list position and queues a `task_position` update.
    public func reorderTask(taskLocalId: String, viewLocalId: String, position: Double) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(
                sql: "UPDATE tasks SET position = ?, updated_at = ?, dirty = 1 WHERE local_id = ?",
                arguments: [position, now, taskLocalId]
            )
            try connection.enqueue(
                .taskPosition, localId: taskLocalId, operation: .update,
                payload: ["view_local_id": viewLocalId, "position": position], at: now
            )
        }
    }

    /// Rewrites positions as an even spread for an explicit order, one `task_position` update each.
    public func reindexTasks(orderedLocalIds: [String], viewLocalId: String, baseStep: Double = Position.baseStep) throws {
        guard !orderedLocalIds.isEmpty else { return }
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            let now = isoNow()
            for (index, localId) in orderedLocalIds.enumerated() {
                let position = Double(index + 1) * baseStep
                try connection.execute(
                    sql: "UPDATE tasks SET position = ?, updated_at = ?, dirty = 1 WHERE local_id = ?",
                    arguments: [position, now, localId]
                )
                try connection.enqueue(
                    .taskPosition, localId: localId, operation: .update,
                    payload: ["view_local_id": viewLocalId, "position": position], at: now
                )
            }
        }
    }

    /// Persists a list drag: one midpoint write when the neighbours allow it, else a full re-index.
    public func applyListReorder(orderedIds: [String], movedId: String, viewLocalId: String) throws {
        let positions = try tasks(matching: TaskQuery(includeDone: true)).reduce(into: [String: Double]()) { result, task in
            if let position = task.position { result[task.localId] = position }
        }
        switch Position.planReorder(orderedIds: orderedIds, movedId: movedId, positionOf: { positions[$0] }) {
        case .midpoint(let position):
            try reorderTask(taskLocalId: movedId, viewLocalId: viewLocalId, position: position)
        case .reindex:
            try reindexTasks(orderedLocalIds: orderedIds, viewLocalId: viewLocalId)
        }
    }
}
