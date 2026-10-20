import Foundation
import GRDB

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
    /// The target is a filter-mode column, which is derived and cannot take cards.
    case readOnly
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

    /// One column of a filter-mode board: a title and a filter query. Ported from `BucketFilterConfig` in `bucketConfig.ts`.
    public struct FilterConfig: Equatable, Sendable {
        public let title: String
        public let filter: String
        public let includeNulls: Bool
    }

    /// Reads the view's `bucket_configuration` JSON: an array of `{ title, filter: { filter, filter_include_nulls } }`.
    public static func filterConfigs(from raw: String?) -> [FilterConfig] {
        guard let raw, let data = raw.data(using: .utf8),
              let entries = (try? JSONSerialization.jsonObject(with: data)) as? [Any] else { return [] }
        return entries.compactMap { entry -> FilterConfig? in
            guard let object = entry as? [String: Any] else { return nil }
            let filter = object["filter"] as? [String: Any]
            return FilterConfig(
                title: object["title"] as? String ?? "",
                filter: filter?["filter"] as? String ?? "",
                includeNulls: filter?["filter_include_nulls"] as? Bool ?? false
            )
        }
    }

    static let filterBucketPrefix = "filter:"

    /// A column's task order after `taskId` is dropped onto the card `targetId` (nil: the column's empty space, so
    /// the end). A card from another column goes before the target. Inside one column the card takes the target's
    /// place, like `arrayMove`: dragged up it lands before the target, dragged down it lands after, so a card can
    /// move down by one.
    public static func orderAfterDrop(order: [String], moving taskId: String, onto targetId: String?) -> [String] {
        var result = order
        let source = result.firstIndex(of: taskId)
        if let source { result.remove(at: source) }
        guard let targetId, let target = result.firstIndex(of: targetId) else {
            result.append(taskId)
            return result
        }
        let movesDown = source.map { $0 <= target } ?? false
        result.insert(taskId, at: movesDown ? target + 1 : target)
        return result
    }

    /// Whether the board's columns come from filters instead of stored buckets. Such a board is read-only: a card
    /// cannot be moved, and columns cannot be added, renamed or deleted.
    public static func isFilterMode(_ view: ViewRecord) -> Bool {
        view.bucketConfigurationMode == .filter
    }

    /// Columns for a filter-mode board. The buckets are synthetic (no server id), and a task can sit in several
    /// columns or none, as on the server. Ported from `buildFilterColumns` in `src/queries/kanban.ts`.
    static func filterColumns(view: ViewRecord, configs: [FilterConfig], matches: [[TaskRecord]]) -> [KanbanColumn] {
        configs.enumerated().map { index, config in
            let bucket = BucketRecord(
                localId: "\(filterBucketPrefix)\(view.localId):\(index)", serverId: nil, viewLocalId: view.localId, title: config.title,
                position: Double(index), limit: 0, createdByServerId: nil, updatedAt: ""
            )
            return KanbanColumn(bucket: bucket, tasks: index < matches.count ? matches[index] : [], positions: [:])
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
        if Kanban.isFilterMode(view) { return try filterKanbanColumns(view: view) }
        let tasks = try self.tasks(matching: TaskQuery(projectLocalId: view.projectLocalId, includeDone: true))
        return Kanban.columns(
            view: view,
            buckets: try buckets(forView: viewLocalId),
            assignments: try bucketAssignments(forView: viewLocalId),
            tasks: tasks
        )
    }

    /// Columns of a filter-mode board, one per configured filter. A filter that does not parse shows an empty column.
    func filterKanbanColumns(view: ViewRecord, now: Date = Date(), calendar: Calendar = .cria) throws -> [KanbanColumn] {
        let configs = Kanban.filterConfigs(from: view.bucketConfiguration)
        let matches = try configs.map { config -> [TaskRecord] in
            guard let parsed = try? parseFilterQuery(config.filter, now: now, calendar: calendar),
                  let compiled = try? compileFilter(parsed.ast, includeNulls: config.includeNulls) else { return [] }
            var conditions = ["t.deleted = 0", "t.project_local_id = ?"]
            if !filterMentionsDone(parsed.ast) { conditions.append("t.done = 0") }
            if !compiled.whereClause.isEmpty { conditions.append("(\(compiled.whereClause))") }
            let order = CriaStore.taskOrder.split(separator: ",").map { "t." + $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            var arguments: [(any DatabaseValueConvertible)?] = [view.projectLocalId]
            arguments += compiled.params.map { $0.databaseValue }
            return try database.writer.read { connection in
                try Row.fetchAll(connection, sql: """
                    SELECT \(CriaStore.qualifiedTaskColumns) FROM tasks t
                     WHERE \(conditions.joined(separator: " AND "))
                     ORDER BY \(order.joined(separator: ", "))
                    """, arguments: StatementArguments(arguments)).map(TaskRecord.init(row:))
            }
        }
        return Kanban.filterColumns(view: view, configs: configs, matches: matches)
    }

    /// `moveCard`, plus the step that puts a card moved to another column back where it was. `source` is the column
    /// the card was shown in. With `alsoComplete` the card is marked done on a cross-column move (a done column).
    public func moveCardUndoable(
        taskLocalId: String, viewLocalId: String, source: KanbanColumn?, target: KanbanColumn, orderedIds: [String],
        alsoComplete: Bool = false
    ) throws -> (result: KanbanMoveResult, undo: TaskUndoStep?) {
        let result = try moveCard(taskLocalId: taskLocalId, viewLocalId: viewLocalId, target: target, orderedIds: orderedIds)
        let crosses = !target.tasks.contains { $0.localId == taskLocalId }
        guard result == .moved, crosses else { return (result, nil) }
        var steps: [TaskUndoStep] = []
        if let source {
            let back = TaskUndoStep.BucketMove(
                taskLocalId: taskLocalId, viewLocalId: viewLocalId, bucketLocalId: source.bucket.localId,
                position: source.positions[taskLocalId]
            )
            steps.append(TaskUndoStep(message: "Moved to \(target.bucket.title)", bucketMoves: [back]))
        }
        if alsoComplete {
            steps.append(try updateTaskUndoable(localId: taskLocalId, patch: TaskPatch(done: true)))
        }
        return (result, TaskUndoStep.combined(steps, message: "Moved to \(target.bucket.title)"))
    }

    /// Drops a card into a column. `orderedIds` is the target column's final order including the moved card.
    /// A cross-column drop into a full column is refused. Positions come from `Position.planReorder`.
    @discardableResult
    public func moveCard(
        taskLocalId: String, viewLocalId: String, target: KanbanColumn, orderedIds: [String]
    ) throws -> KanbanMoveResult {
        if target.bucket.serverId == nil, target.bucket.localId.hasPrefix(Kanban.filterBucketPrefix) { return .readOnly }
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
            // Passing the bucket makes this an upsert: a card shown through the default-bucket fallback has no row yet.
            try updateTaskPosition(
                taskLocalId: taskLocalId, viewLocalId: viewLocalId, position: position, bucketLocalId: target.bucket.localId
            )
        case .reindex:
            try reorderTasksInBucket(
                viewLocalId: viewLocalId, bucketLocalId: target.bucket.localId, orderedTaskIds: orderedIds
            )
        }
        return .moved
    }
}
