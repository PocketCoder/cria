import Foundation
import GRDB

/// Sidebar drag reorder for projects, among siblings only (as the desktop app). The push sends the whole row, so a
/// changed position goes to the server with the next project update. Ported from `computeDropPosition` in
/// `src/features/projects/sidebarLogic.ts`, using the same position maths as task and view reorders.
extension CriaStore {
    /// Persists a move: one midpoint write when the neighbours leave room, otherwise even steps for the whole list.
    /// `orderedLocalIds` is the siblings' order after the move.
    public func reorderProjects(_ orderedLocalIds: [String], moved movedId: String) throws {
        let positions = Dictionary(try projects().map { ($0.localId, $0.position) }, uniquingKeysWith: { first, _ in first })
        let plan = Position.planReorder(orderedIds: orderedLocalIds, movedId: movedId) { positions[$0] ?? nil }
        switch plan {
        case .midpoint(let position):
            try setProjectPosition(localId: movedId, position: position)
        case .reindex:
            try reindexProjects(orderedLocalIds)
        }
    }

    public func setProjectPosition(localId: String, position: Double) throws {
        try userWrite(announcing: [.projects, .outbox]) { connection in
            let now = isoNow()
            try connection.execute(
                sql: "UPDATE projects SET position = ?, dirty = 1, updated_at = ? WHERE local_id = ? AND deleted = 0",
                arguments: [position, now, localId]
            )
            guard connection.changesCount > 0 else { throw CriaStoreError.notFound(localId) }
            try connection.enqueue(.project, localId: localId, operation: .update, payload: ["position": position], at: now)
        }
    }

    /// Rewrites the given projects' positions as `baseStep`, `2 × baseStep`, ... in this order.
    public func reindexProjects(_ orderedLocalIds: [String], baseStep: Double = Position.baseStep) throws {
        guard !orderedLocalIds.isEmpty else { return }
        try userWrite(announcing: [.projects, .outbox]) { connection in
            let now = isoNow()
            for (index, localId) in orderedLocalIds.enumerated() {
                let position = Double(index + 1) * baseStep
                try connection.execute(
                    sql: "UPDATE projects SET position = ?, dirty = 1, updated_at = ? WHERE local_id = ? AND deleted = 0",
                    arguments: [position, now, localId]
                )
                try connection.enqueue(.project, localId: localId, operation: .update, payload: ["position": position], at: now)
            }
        }
    }
}
