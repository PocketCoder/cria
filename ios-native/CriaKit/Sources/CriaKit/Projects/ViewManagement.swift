import Foundation

public typealias ViewKind = ViewResponse.ViewKind

/// The fields of a view that management rules read. Lets the rules run without database rows.
public struct ViewSlot: Equatable, Sendable {
    public let localId: String
    public let title: String
    public let kind: ViewKind
    public let position: Double?
    public let placeholder: Bool

    public init(localId: String, title: String = "", kind: ViewKind = .list, position: Double? = nil, placeholder: Bool = false) {
        self.localId = localId
        self.title = title
        self.kind = kind
        self.position = position
        self.placeholder = placeholder
    }
}

extension ViewRecord {
    public var slot: ViewSlot {
        ViewSlot(localId: localId, title: title, kind: viewKind, position: position, placeholder: placeholder)
    }
}

/// Why a view cannot be deleted.
public enum ViewDeleteBlocker: Equatable, Sendable {
    /// A project must keep at least one view.
    case lastView
    /// A local default with no server counterpart: deleting it would just return on the next pull.
    case placeholder
}

/// A planned view reorder: every id in its new order, and how to persist it.
public struct ViewReorder: Equatable, Sendable {
    public let orderedIds: [String]
    public let plan: ReorderPlan
}

/// Ported from `src/lib/viewManagement.ts`.
public enum ViewManagement {
    /// The kinds offered when adding a view, in Vikunja's default order.
    public static let kinds: [ViewKind] = [.list, .gantt, .table, .kanban]

    /// Vikunja's web UI calls kanban "Board".
    public static func kindLabel(_ kind: ViewKind) -> String {
        switch kind {
        case .list: return "List"
        case .gantt: return "Gantt"
        case .table: return "Table"
        case .kanban: return "Board"
        }
    }

    /// Negative server ids are pseudo-projects (favourites, saved filters). Local-only and real projects qualify.
    public static func canManageViews(projectServerId: Int?) -> Bool {
        projectServerId.map { $0 > 0 } ?? true
    }

    /// A view's display name: its title, else the label for its kind.
    public static func label(_ view: ViewSlot) -> String {
        view.title.isEmpty ? kindLabel(view.kind) : view.title
    }

    /// The kind label to show beside a title, or nil when the title already says it.
    public static func kindHint(_ view: ViewSlot) -> String? {
        let name = kindLabel(view.kind)
        let title = view.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if title.isEmpty || title == view.kind.rawValue || title == name.lowercased() { return nil }
        return name
    }

    /// Title for a new view: the typed text, else the kind's label.
    public static func newViewTitle(draft: String, kind: ViewKind) -> String {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? kindLabel(kind) : trimmed
    }

    /// Why `localId` cannot be deleted from `views`, or nil when it can. Last-view wins over placeholder.
    public static func deleteBlocker(_ views: [ViewSlot], localId: String) -> ViewDeleteBlocker? {
        guard let view = views.first(where: { $0.localId == localId }) else { return nil }
        if views.count <= 1 { return .lastView }
        return view.placeholder ? .placeholder : nil
    }

    /// The view to open after deleting `deletedId`: the one below it, else the one above.
    public static func viewAfterDelete(_ views: [ViewSlot], deletedId: String) -> String? {
        guard let index = views.firstIndex(where: { $0.localId == deletedId }) else { return nil }
        if index + 1 < views.count { return views[index + 1].localId }
        return index > 0 ? views[index - 1].localId : nil
    }

    /// Reorder needs something to reorder and no placeholder, whose update could never be pushed.
    public static func canReorder(_ views: [ViewSlot]) -> Bool {
        views.count > 1 && views.allSatisfy { !$0.placeholder }
    }

    /// Plans dropping `activeId` onto `overId`'s slot. Nil when nothing moves.
    public static func planReorder(_ views: [ViewSlot], activeId: String, overId: String) -> ViewReorder? {
        if activeId == overId { return nil }
        let ids = views.map(\.localId)
        guard let from = ids.firstIndex(of: activeId), let target = ids.firstIndex(of: overId) else { return nil }
        var ordered = ids
        ordered.remove(at: from)
        ordered.insert(activeId, at: target)
        let positions = Dictionary(views.map { ($0.localId, $0.position) }, uniquingKeysWith: { first, _ in first })
        let plan = Position.planReorder(orderedIds: ordered, movedId: activeId) { positions[$0] ?? nil }
        return ViewReorder(orderedIds: ordered, plan: plan)
    }
}
