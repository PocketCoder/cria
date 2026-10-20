import CriaKit
import SwiftUI

/// Drag a table row onto another to move it there. The row's first cell (or the whole compact row) is the handle;
/// any cell is a drop target. `onMove` gets the dragged task and the task it was dropped on.
struct TableRowReorder: ViewModifier {
    let id: String
    let isHandle: Bool
    let onMove: (String, String) -> Void

    func body(content: Content) -> some View {
        if isHandle {
            content.draggable(KanbanPayload.make(id)).dropDestination(for: String.self) { items, _ in drop(items) }
        } else {
            content.dropDestination(for: String.self) { items, _ in drop(items) }
        }
    }

    private func drop(_ items: [String]) -> Bool {
        guard let movedId = items.first.flatMap(KanbanPayload.taskId(from:)), movedId != id else { return false }
        onMove(movedId, id)
        return true
    }
}

/// Makes a grid cell part of drag-to-reorder: the first cell of a row lifts it, any cell takes a drop.
struct TableReorderHandle: ViewModifier {
    let id: String
    let isFirst: Bool
    let onMove: ((String, String) -> Void)?

    func body(content: Content) -> some View {
        if let onMove {
            content.modifier(TableRowReorder(id: id, isHandle: isFirst, onMove: onMove))
        } else {
            content
        }
    }
}

extension TableViewScreen {
    /// The table view's id, else the project's first table view, else its list view.
    private func reorderViewLocalId() -> String? {
        if let viewLocalId { return viewLocalId }
        let all = (try? services.store.views(forProject: projectLocalId)) ?? []
        if let table = all.first(where: { $0.viewKind == .table }) { return table.localId }
        return try? services.store.listViewLocalId(projectLocalId: projectLocalId)
    }

    /// Moves a row to where another sits and saves the order as positions, as in the list view. A drag means manual
    /// order, so any column sort is dropped (otherwise the next refresh would sort the row back).
    func moveRow(_ movedId: String, onto overId: String) {
        let ids = rows.map(\.task.localId)
        guard let from = ids.firstIndex(of: movedId), let target = ids.firstIndex(of: overId), from != target else { return }
        var order = ids
        order.move(fromOffsets: IndexSet(integer: from), toOffset: target > from ? target + 1 : target)
        do {
            guard let viewId = reorderViewLocalId() else { return }
            optimistic.set(order, over: manualOrder())
            try services.store.applyListReorder(orderedIds: order, movedId: movedId, viewLocalId: viewId)
            sortText = ""
            reorders += 1
        } catch {
            optimistic = OptimisticOrder()
            editFailure = String(describing: error)
        }
    }
}
