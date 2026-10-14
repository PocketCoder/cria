import CriaKit
import Observation
import SwiftUI

enum MacSelection: Hashable {
    case inbox, today, upcoming, favorites, search
    case project(String)
    case savedFilter(Int)
}

/// What the window is showing and the things menus, keys and the palette ask it to do. One per window; menus reach
/// it through `FocusedValue`.
@MainActor @Observable
final class MacActions {
    var selection: MacSelection? = .today
    /// The task shown in the detail column.
    var openTaskId: String?
    var addRequest: QuickAddRequest?
    var creatingProject = false
    var showingPalette = false
    var showingShortcuts = false
    var columns = NavigationSplitViewVisibility.all

    func go(_ destination: MacSelection) {
        selection = destination
        openTaskId = nil
    }

    /// Opens what a `cria://` link or a tapped notification points at.
    func open(_ url: URL, services: AppServices) {
        guard let link = DeepLink(url: url), let destination = try? link.destination(in: services.store) else { return }
        switch destination {
        case .quickAdd(let title):
            addRequest = QuickAddRequest(title: title ?? "")
        case .open(let tab, let route):
            switch (tab, route) {
            case (_, .task(let id)?):
                openTaskId = id
            case (_, .project(let id)?): go(.project(id))
            case (_, .inbox?): go(.inbox)
            case (_, .favorites?): go(.favorites)
            case (_, .savedFilter(let id)?): go(.savedFilter(id))
            case (.upcoming, _): go(.upcoming)
            case (.search, _): go(.search)
            default: go(.today)
            }
        }
    }

    /// Shows a task in the detail column. Clicking the task already open leaves it alone, so the detail (and any
    /// edit in progress) is not rebuilt.
    func openTask(_ id: String) {
        TaskOpenSignposts.event("click", id)
        guard openTaskId != id else { return }
        openTaskId = id
    }

    func newTask() {
        addRequest = QuickAddRequest(title: "")
    }

    func toggleSidebar() {
        columns = columns == .detailOnly ? .all : .detailOnly
    }

    var hasOpenTask: Bool { openTaskId != nil }

    func task(_ command: TaskCommand) {
        guard let id = openTaskId else { return }
        NotificationCenter.default.post(name: .criaTaskCommand, object: command.rawValue, userInfo: ["task": id])
    }

    func projectView(_ kind: String) {
        NotificationCenter.default.post(name: .criaProjectViewCommand, object: kind)
    }
}

private struct MacActionsKey: FocusedValueKey {
    typealias Value = MacActions
}

extension FocusedValues {
    var macActions: MacActions? {
        get { self[MacActionsKey.self] }
        set { self[MacActionsKey.self] = newValue }
    }
}
