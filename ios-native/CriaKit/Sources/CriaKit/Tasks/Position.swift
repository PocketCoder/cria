import Foundation

/// How a drag reorder should be persisted. Ported from `src/lib/position.ts`.
public enum ReorderPlan: Equatable, Sendable {
    /// One strictly-between position write is enough.
    case midpoint(Double)
    /// Neighbours are missing or collide: rewrite the whole list in even steps.
    case reindex
}

public enum Position {
    public static let baseStep: Double = 1024

    /// Position between two neighbours: midpoint, `lower + step` at the bottom, `upper / 2` at the top.
    public static func calculate(before lower: Double?, after upper: Double?, baseStep step: Double = baseStep) -> Double {
        switch (lower, upper) {
        case (nil, nil): return step
        case let (lowerValue?, nil): return lowerValue + step
        case let (nil, upperValue?): return upperValue / 2
        case let (lowerValue?, upperValue?): return (lowerValue + upperValue) / 2
        }
    }

    /// Whether a single midpoint write is safe. False means the caller must re-index the list.
    public static func canMidpoint(before lower: Double?, after upper: Double?) -> Bool {
        switch (lower, upper) {
        case (nil, nil): return false
        case (nil, let upperValue?): return upperValue > 0
        case (_?, nil): return true
        case let (lowerValue?, upperValue?): return lowerValue < upperValue
        }
    }

    /// Decides how to persist a reorder, given the final id order and the moved id.
    public static func planReorder(
        orderedIds: [String], movedId: String, positionOf: (String) -> Double?
    ) -> ReorderPlan {
        guard let index = orderedIds.firstIndex(of: movedId) else { return .reindex }
        let hasBefore = index > 0
        let hasAfter = index < orderedIds.count - 1
        let lower = hasBefore ? positionOf(orderedIds[index - 1]) : nil
        let upper = hasAfter ? positionOf(orderedIds[index + 1]) : nil
        if hasBefore && lower == nil { return .reindex }
        if hasAfter && upper == nil { return .reindex }
        guard canMidpoint(before: lower, after: upper) else { return .reindex }
        return .midpoint(calculate(before: lower, after: upper))
    }
}
