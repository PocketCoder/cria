import Foundation

/// One kanban column: a bucket with its cards in display order. Ported from `KanbanColumn` in `src/queries/kanban.ts`.
public struct KanbanColumn: Equatable, Sendable {
    public let bucket: BucketRecord
    public let tasks: [TaskRecord]
    /// Per-bucket position of each task, keyed by task local id. Feeds `Position.planReorder`.
    public let positions: [String: Double]

    public var atLimit: Bool { Kanban.isAtLimit(limit: bucket.limit, count: tasks.count) }
}

/// Why a card drop was refused or how it was persisted.
public enum KanbanMoveResult: Equatable, Sendable {
    case moved
    case blockedByLimit
}

public enum Kanban {
    /// WIP limits only block drops from another column; reordering inside a full column is allowed.
    public static func isAtLimit(limit: Int, count: Int) -> Bool {
        limit > 0 && count >= limit
    }

    /// A limit draft ("3", "", "abc", "-2") as a non-negative integer.
    public static func parseLimit(_ draft: String) -> Int {
        max(0, Int(draft.trimmingCharacters(in: .whitespaces)) ?? 0)
    }

    /// Whether a bucket is the view's done or default bucket.
    public static func roles(of bucket: BucketRecord, in view: ViewRecord) -> (isDone: Bool, isDefault: Bool) {
        guard let serverId = bucket.serverId else { return (false, false) }
        return (view.doneBucketServerId == serverId, view.defaultBucketServerId == serverId)
    }

    /// Columns from buckets, task to bucket assignments and tasks. Explicit assignments place open tasks;
    /// done tasks go to the done bucket; anything left falls into the default (or first) bucket.
    public static func columns(
        view: ViewRecord, buckets: [BucketRecord], assignments: [TaskBucketRecord], tasks: [TaskRecord]
    ) -> [KanbanColumn] {
        let tasksById = Dictionary(tasks.map { ($0.localId, $0) }, uniquingKeysWith: { first, _ in first })
        var assignedByBucket: [String: [TaskBucketRecord]] = [:]
        for assignment in assignments {
            assignedByBucket[assignment.bucketLocalId, default: []].append(assignment)
        }
        var placed = Set<String>()
        var lists: [[TaskRecord]] = []
        var positionMaps: [[String: Double]] = []
        for bucket in buckets {
            var cards: [TaskRecord] = []
            var positions: [String: Double] = [:]
            for assignment in assignedByBucket[bucket.localId] ?? [] {
                guard let task = tasksById[assignment.taskLocalId], !task.done, !placed.contains(task.localId) else { continue }
                cards.append(task)
                placed.insert(task.localId)
                if let position = assignment.position { positions[task.localId] = position }
            }
            lists.append(cards)
            positionMaps.append(positions)
        }
        if let doneIndex = buckets.firstIndex(where: { $0.serverId != nil && $0.serverId == view.doneBucketServerId }) {
            for task in tasks where task.done && !placed.contains(task.localId) {
                lists[doneIndex].append(task)
                placed.insert(task.localId)
            }
        }
        let unplaced = tasks.filter { !placed.contains($0.localId) }
        if !unplaced.isEmpty, let fallback = fallbackIndex(view: view, buckets: buckets) {
            lists[fallback].append(contentsOf: unplaced)
        }
        return buckets.indices.map { index in
            KanbanColumn(bucket: buckets[index], tasks: lists[index], positions: positionMaps[index])
        }
    }

    private static func fallbackIndex(view: ViewRecord, buckets: [BucketRecord]) -> Int? {
        if let defaultId = view.defaultBucketServerId,
           let index = buckets.firstIndex(where: { $0.serverId == defaultId }) {
            return index
        }
        return buckets.isEmpty ? nil : 0
    }
}

extension CriaStore {
    /// Board columns for a manual-bucket kanban view, from the local cache.
    public func kanbanColumns(viewLocalId: String) throws -> [KanbanColumn] {
        guard let view = try view(localId: viewLocalId) else { return [] }
        let tasks = try self.tasks(matching: TaskQuery(projectLocalId: view.projectLocalId, includeDone: true))
        return Kanban.columns(
            view: view,
            buckets: try buckets(forView: viewLocalId),
            assignments: try bucketAssignments(forView: viewLocalId),
            tasks: tasks
        )
    }

    /// Drops a card into a column. `orderedIds` is the target column's final order including the moved card.
    /// A cross-column drop into a full column is refused. Positions come from `Position.planReorder`.
    @discardableResult
    public func moveCard(
        taskLocalId: String, viewLocalId: String, target: KanbanColumn, orderedIds: [String]
    ) throws -> KanbanMoveResult {
        let crossesColumns = !target.tasks.contains { $0.localId == taskLocalId }
        if crossesColumns && Kanban.isAtLimit(limit: target.bucket.limit, count: target.tasks.count) {
            return .blockedByLimit
        }
        if crossesColumns {
            try setTaskBucket(taskLocalId: taskLocalId, viewLocalId: viewLocalId, bucketLocalId: target.bucket.localId)
        }
        let plan = Position.planReorder(orderedIds: orderedIds, movedId: taskLocalId) { target.positions[$0] }
        switch plan {
        case .midpoint(let position):
            try updateTaskPosition(taskLocalId: taskLocalId, viewLocalId: viewLocalId, position: position)
        case .reindex:
            try reorderTasksInBucket(
                viewLocalId: viewLocalId, bucketLocalId: target.bucket.localId, orderedTaskIds: orderedIds
            )
        }
        return .moved
    }
}
