import CriaKit
import Observation
import SwiftUI

enum MacSelection: Hashable {
    case inbox, today, upcoming, favorites, search
    case project(String)
    case savedFilter(Int)
    case label(String)

    /// Settings > Customise > Home view. Browse has no Mac counterpart, so it opens Today.
    init(home tab: AppTab) {
        switch tab {
        case .upcoming: self = .upcoming
        case .inbox: self = .inbox
        case .favorites: self = .favorites
        case .search: self = .search
        case .today, .browse: self = .today
        }
    }
}

/// What the window is showing and the things menus, keys and the palette ask it to do. One per window; menus reach
/// it through `FocusedValue`.
@MainActor @Observable
final class MacActions {
    var selection: MacSelection? = .today
    /// The task open in the panel, kept in its own object so only the views that show it follow it.
    let panel = OpenTaskState()
    /// The sidebar's sheets and confirmations (project, label and filter actions).
    let sidebar = MacSidebarActions()
    /// Made once, so handing them to the environment on every shell update is not a change that redraws each row.
    @ObservationIgnored private(set) var opener: @MainActor (String) -> Void = { _ in }
    @ObservationIgnored private(set) var closer: @MainActor () -> Void = {}
    var addRequest: QuickAddRequest?
    var creatingProject = false
    var showingPalette = false
    var showingShortcuts = false
    var columns = NavigationSplitViewVisibility.all
    /// Bumped by Sync Now; the shell runs a sync for each new value.
    var syncRequest = 0
    /// The toolbar search text. While it has text the content column shows search results.
    var query = ""
    /// Bumped by Go > Search (⌘F); the shell focuses the toolbar field for each new value.
    var searchRequest = 0

    init() {
        opener = { [weak self] id in self?.openTask(id) }
        closer = { [weak self] in self?.openTaskId = nil }
    }

    /// The task shown in the panel.
    var openTaskId: String? {
        get { panel.id }
        set { panel.id = newValue }
    }

    func go(_ destination: MacSelection) {
        // Search is the toolbar field, not a screen.
        if destination == .search {
            searchRequest += 1
            return
        }
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
            case (_, .label(let id)?): go(.label(id))
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
        panel.focusedId = id
        guard openTaskId != id else { return }
        openTaskId = id
    }

    /// `j` and `k`: moves the keyboard focus through the list on screen, from the focused or open task, stopping at
    /// either end. False when there is no list.
    func moveFocus(_ step: Int) -> Bool {
        let ids = panel.visibleIds
        guard !ids.isEmpty else { return false }
        let index = (panel.focusedId ?? openTaskId).flatMap { ids.firstIndex(of: $0) }
        let next = index.map { min(max($0 + step, 0), ids.count - 1) } ?? (step > 0 ? 0 : ids.count - 1)
        panel.focusedId = ids[next]
        return true
    }

    /// Return: opens the focused task. False when nothing is focused, so the key goes on to the control that has it.
    func openFocused() -> Bool {
        guard let id = panel.focusedId, panel.visibleIds.contains(id) else { return false }
        openTask(id)
        return true
    }

    /// `u`: shows the open task's project (which closes the task, as any new list does).
    func goToOpenTasksProject(services: AppServices) -> Bool {
        guard let id = openTaskId, let project = (try? services.store.task(localId: id))?.projectLocalId else { return false }
        go(.project(project))
        return true
    }

    func newTask() {
        addRequest = QuickAddRequest(title: "")
    }

    func syncNow() {
        syncRequest += 1
    }

    func toggleSidebar() {
        columns = columns == .detailOnly ? .all : .detailOnly
    }

    var hasOpenTask: Bool { openTaskId != nil }

    /// The toolbar's inspector button: closes the open task, or opens the focused one (else the first on screen).
    func toggleInspector() {
        if openTaskId != nil {
            openTaskId = nil
        } else if let id = panel.focusedId ?? panel.visibleIds.first {
            openTask(id)
        }
    }

    func task(_ command: TaskCommand) {
        post(command.rawValue)
    }

    func task(_ shortcut: TaskShortcut) {
        post(shortcut.rawValue)
    }

    private func post(_ raw: String) {
        guard let id = openTaskId else { return }
        NotificationCenter.default.post(name: .criaTaskCommand, object: raw, userInfo: ["task": id])
    }

    func projectView(_ kind: String) {
        NotificationCenter.default.post(name: .criaProjectViewCommand, object: kind)
    }

    /// View > Show Project Info: the project on screen shows or hides its info rail.
    func toggleProjectInfo() {
        NotificationCenter.default.post(name: .criaProjectInfoCommand, object: nil)
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
