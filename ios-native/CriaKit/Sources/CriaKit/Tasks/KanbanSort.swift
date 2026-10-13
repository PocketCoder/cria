import Foundation

/// The optional "sort board cards by due date" (Cria-only setting). Applied only to what a column draws: the stored
/// positions are untouched, so turning it off brings the dragged order back.
public enum KanbanSort {
    /// Soonest due first, cards with no due date last; equal dates (and undated cards) keep their current order. Dates
    /// are compared as instants, since server and local timestamps can carry different offsets.
    public static func byDueDate(_ cards: [KanbanCardPlan]) -> [KanbanCardPlan] {
        let keyed = cards.enumerated().map { (index: $0.offset, card: $0.element, due: $0.element.task.dueDate.flatMap(DueDates.parse)) }
        return keyed.sorted { lhs, rhs in
            switch (lhs.due, rhs.due) {
            case let (left?, right?): return left == right ? lhs.index < rhs.index : left < right
            case (_?, nil): return true
            case (nil, _?): return false
            case (nil, nil): return lhs.index < rhs.index
            }
        }.map(\.card)
    }
}
