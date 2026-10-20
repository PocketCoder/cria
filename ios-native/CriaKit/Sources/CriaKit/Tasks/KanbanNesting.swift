import Foundation

/// A subtask listed inside its parent's card.
public struct KanbanSubtaskRow: Equatable, Sendable, Identifiable {
    public let task: TaskRecord
    /// 0 for a direct child of the card, then one more per level (capped at `KanbanNesting.maxDepth`).
    public let depth: Int
    public var id: String { task.localId }
}

/// One card to draw in a column: a task, the subtasks nested inside it, and the parent it names when the parent
/// sits in another column.
public struct KanbanCardPlan: Equatable, Sendable, Identifiable {
    public let task: TaskRecord
    public let subtasks: [KanbanSubtaskRow]
    /// Set only for a card whose parent is on the board, visible, and in a different column.
    public let parentTitle: String?
    public var id: String { task.localId }

    public var doneSubtasks: Int { subtasks.filter { $0.task.done }.count }
}

public struct KanbanColumnPlan: Equatable, Sendable {
    public static let empty = KanbanColumnPlan(cards: [], hiddenCount: 0)

    public let cards: [KanbanCardPlan]
    /// Tasks of the column the filter keeps off the board (neither a card nor a listed subtask).
    public let hiddenCount: Int
}

public struct KanbanBoardPlan: Equatable, Sendable {
    public static let empty = KanbanBoardPlan(columns: [:])

    /// By bucket local id.
    public let columns: [String: KanbanColumnPlan]

    public func column(_ bucketLocalId: String) -> KanbanColumnPlan { columns[bucketLocalId] ?? .empty }
    public var hiddenCount: Int { columns.values.reduce(0) { $0 + $1.hiddenCount } }
}

/// Which cards a board column draws, and which tasks ride inside another card. Vikunja puts every task in exactly
/// one column, so a subtask can sit away from its parent:
/// - parent in the same column: no card of its own, listed in the parent's card;
/// - parent in another column: its own card, naming the parent;
/// - parent not on the board, or hidden by the board filter: a plain card.
/// The column's own task list is untouched, so counts, limits and drops still see every task.
public enum KanbanNesting {
    public static let maxDepth = 3

    /// `children` is the parent to subtasks map, read once per board load. `shows` is the board filter: it applies
    /// to cards, and a nested subtask it hides is simply not listed. A hidden parent hands its shown subtasks up
    /// as plain cards, so a task the filter matches never disappears behind one it does not. With `nests` false
    /// every subtask is a card of its own that drags on its own, naming its parent wherever it is.
    public static func plan(
        columns: [KanbanColumn], children: [String: [String]], nests: Bool = true,
        shows: @escaping (TaskRecord) -> Bool = { _ in true }
    ) -> KanbanBoardPlan {
        var onBoard: [String: TaskRecord] = [:]
        // Parents on the board per task, in board order, so the choice of caption parent does not depend on hashing.
        var parentsOf: [String: [String]] = [:]
        for task in columns.flatMap(\.tasks) where onBoard[task.localId] == nil {
            onBoard[task.localId] = task
            for kid in children[task.localId] ?? [] where kid != task.localId { parentsOf[kid, default: []].append(task.localId) }
        }
        var plans: [String: KanbanColumnPlan] = [:]
        for column in columns {
            var walker = ColumnWalker(tasks: column.tasks, children: nests ? children : [:], shows: shows)
            let cards = walker.cards().map { card in
                KanbanCardPlan(
                    task: card.task, subtasks: card.subtasks,
                    parentTitle: captionParent(
                        of: card.task, parentsOf: parentsOf, onBoard: onBoard, column: column, sameColumn: !nests, shows: shows
                    )
                )
            }
            let listed = cards.reduce(cards.count) { $0 + $1.subtasks.count }
            plans[column.bucket.localId] = KanbanColumnPlan(cards: cards, hiddenCount: column.tasks.count - listed)
        }
        return KanbanBoardPlan(columns: plans)
    }

    private static func captionParent(
        of task: TaskRecord, parentsOf: [String: [String]], onBoard: [String: TaskRecord], column: KanbanColumn,
        sameColumn: Bool, shows: (TaskRecord) -> Bool
    ) -> String? {
        let here = Set(column.tasks.map(\.localId))
        for parent in parentsOf[task.localId] ?? [] where sameColumn || !here.contains(parent) {
            if let record = onBoard[parent], shows(record) { return record.title }
        }
        return nil
    }
}

/// Walks one column: top-level tasks in column order, each taking its same-column descendants as subtasks.
private struct ColumnWalker {
    let byId: [String: TaskRecord]
    let order: [String]
    let roots: [String]
    /// Direct same-column subtasks per task, in column order.
    var kidsOf: [String: [String]] = [:]
    let shows: (TaskRecord) -> Bool
    var placed = Set<String>()
    var result: [(task: TaskRecord, subtasks: [KanbanSubtaskRow])] = []

    init(tasks: [TaskRecord], children: [String: [String]], shows: @escaping (TaskRecord) -> Bool) {
        byId = Dictionary(tasks.map { ($0.localId, $0) }, uniquingKeysWith: { first, _ in first })
        order = tasks.map(\.localId)
        self.shows = shows
        var parentOf: [String: String] = [:]
        for task in tasks {
            for kid in children[task.localId] ?? [] where kid != task.localId && byId[kid] != nil && parentOf[kid] == nil {
                parentOf[kid] = task.localId
            }
        }
        for id in order {
            if let parent = parentOf[id] { kidsOf[parent, default: []].append(id) }
        }
        roots = order.filter { parentOf[$0] == nil }
    }

    mutating func cards() -> [(task: TaskRecord, subtasks: [KanbanSubtaskRow])] {
        for id in roots { visit(id) }
        // Only a parent cycle leaves tasks unplaced; they still show.
        for id in order { visit(id) }
        return result
    }

    private mutating func visit(_ id: String) {
        guard let task = byId[id], placed.insert(id).inserted else { return }
        if shows(task) {
            var rows: [KanbanSubtaskRow] = []
            collect(from: id, depth: 0, into: &rows)
            result.append((task, rows))
        } else {
            for kid in kidsOf[id] ?? [] { visit(kid) }
        }
    }

    /// The descendants of `id`, depth first. A hidden one is skipped but its shown descendants stay listed.
    private mutating func collect(from id: String, depth: Int, into rows: inout [KanbanSubtaskRow]) {
        for kid in kidsOf[id] ?? [] {
            guard let task = byId[kid], placed.insert(kid).inserted else { continue }
            if shows(task) {
                rows.append(KanbanSubtaskRow(task: task, depth: min(depth, KanbanNesting.maxDepth)))
                collect(from: kid, depth: depth + 1, into: &rows)
            } else {
                collect(from: kid, depth: depth, into: &rows)
            }
        }
    }
}
