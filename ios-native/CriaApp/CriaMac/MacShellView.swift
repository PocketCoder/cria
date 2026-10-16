import CriaKit
import SwiftUI
import UniformTypeIdentifiers

/// The sidebar and the shared screens for the selection, with the open task in a panel over them. Task rows open into
/// the panel (through `taskOpener`) instead of pushing.
struct MacShellView: View {
    let services: AppServices
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @Binding var pendingURL: URL?
    @State private var actions = MacActions()
    @State private var navigation = NavigationModel()
    @State private var undoCenter = UndoCenter()
    @State private var keys = KeySequencer()
    @State private var conflictPrompt = ConflictPrompt()
    @Environment(\.preferences) private var preferences

    var body: some View {
        NavigationSplitView(columnVisibility: $actions.columns) {
            MacSidebar(services: services, actions: actions)
        } detail: {
            MacContent(services: services, actions: actions, navigation: navigation)
                // Sync progress, errors with Retry, conflicts to resolve and changes that could not sync, as on iOS.
                .safeAreaInset(edge: .top, spacing: 0) { SyncBanner(services: services, conflicts: conflictPrompt) }
        }
        // A click anywhere outside the panel closes it. Simultaneous, so a row or the sidebar still gets its click;
        // when that click opened another task the id has changed by the next turn and the panel stays.
        .simultaneousGesture(TapGesture().onEnded { closePanelUnlessReplaced() })
        // The open task floats over the list on a glass panel, as in the old app, instead of being a split column: no
        // column to re-lay out when it opens, and the list keeps its full width underneath.
        .overlay(alignment: .trailing) { MacTaskPanel(services: services, actions: actions) }
        .animation(.snappy(duration: 0.28), value: actions.openTaskId != nil)
        .onExitCommand { actions.openTaskId = nil }
        .focusable()
        .focusEffectDisabled()
        .onKeyPress { keys.handle($0, actions: actions) }
        .focusedSceneValue(\.macActions, actions)
        // A new list starts clean: no pushed route from the old one, no task left open.
        .onChange(of: actions.selection) {
            navigation.state.setPath([], for: .browse)
            actions.openTaskId = nil
        }
        .environment(\.taskCloser, actions.closer)
        .environment(navigation)
        .environment(undoCenter)
        .overlay(alignment: .bottom) { UndoToast(center: undoCenter) }
        .task { undoCenter.attach(services) }
        // A conflicted change holds up the outbox until it is resolved, so the sheet opens as on iOS.
        .task { await conflictPrompt.run(store: services.store) }
        .task {
            // The home view from Settings > Customise first, so a link that opened the window still wins.
            actions.selection = MacSelection(home: preferences.custom.homeView)
            openPendingURL()
        }
        .onReceive(NotificationCenter.default.publisher(for: .criaQuickAdd)) { _ in actions.newTask() }
        .task(id: actions.syncRequest) {
            if actions.syncRequest > 0 { await services.refresh() }
        }
        .onChange(of: pendingURL) { openPendingURL() }
        .sheet(item: $actions.addRequest) { request in
            QuickAddSheet(services: services, contextProjectId: contextProject, initialLine: request.title)
        }
        .sheet(isPresented: $actions.creatingProject) {
            ProjectEditorSheet(services: services, target: .create, projects: (try? services.store.projects()) ?? [])
        }
        .sheet(isPresented: $actions.showingPalette) { CommandPalette(services: services, actions: actions) }
        .sheet(isPresented: $actions.showingShortcuts) { ShortcutsHelp() }
        .modifier(MacSidebarSheets(services: services, sheets: actions.sidebar))
        .sheet(
            isPresented: $conflictPrompt.isPresented,
            onDismiss: { conflictPrompt.sheetDismissed() },
            content: { ConflictSheet(services: services, prompt: conflictPrompt).macSheetFrame() }
        )
    }

    private func closePanelUnlessReplaced() {
        guard let id = actions.openTaskId else { return }
        DispatchQueue.main.async {
            if actions.openTaskId == id { actions.openTaskId = nil }
        }
    }

    private func openPendingURL() {
        guard let url = pendingURL else { return }
        pendingURL = nil
        actions.open(url, services: services)
    }

    /// New tasks go to the project on screen.
    private var contextProject: String? {
        if case .project(let id)? = actions.selection { return id }
        return nil
    }
}

/// The list for the sidebar selection. Its own view reading only the selection, so opening or closing a task (which
/// updates the shell) does not rebuild the screen and every row in it.
private struct MacContent: View {
    let services: AppServices
    let actions: MacActions
    let navigation: NavigationModel

    var body: some View {
        NavigationStack(path: navigation.pathBinding(for: .browse)) {
            root
                .criaCanvas()
                .navigationDestination(for: Route.self) { MacRouteDestination(route: $0, services: services).criaCanvas() }
        }
        .environment(\.taskOpener, actions.opener)
        .environment(\.openTaskState, actions.panel)
        .id(actions.selection)
    }

    @ViewBuilder
    private var root: some View {
        switch actions.selection ?? .today {
        case .inbox: InboxScreen(services: services)
        case .today: SmartViewScreen(services: services, view: .today, title: "Today")
        case .upcoming: SmartViewScreen(services: services, view: .upcoming, title: "Upcoming")
        case .favorites: TaskListView(services: services, source: .favorites, title: "Favourites")
        case .search: SearchScreen(services: services)
        case .project(let localId):
            let title = (try? services.store.project(localId: localId))?.title ?? "Project"
            ProjectScreen(services: services, projectLocalId: localId, title: title)
        case .savedFilter(let serverId): SavedFilterScreen(services: services, serverId: serverId)
        case .label(let localId):
            let title = (try? services.store.labels())?.first { $0.localId == localId }?.title ?? "Label"
            TaskListView(services: services, source: .label(localId), title: title)
        }
    }
}

private extension View {
    /// The warm page colour behind the list screens (the web's `--color-background`), in place of the system's
    /// white or grey. Only here: the task panel keeps its glass and sheets keep the system look.
    func criaCanvas() -> some View {
        scrollContentBackground(.hidden).background(Color(.background))
    }
}

/// The open task, floating over the list on a glass panel. Its own view, so the detail is built when the open task
/// changes and not on every shell update.
private struct MacTaskPanel: View {
    let services: AppServices
    let actions: MacActions

    var body: some View {
        if let id = actions.openTaskId {
            NavigationStack {
                TaskDetailView(services: services, taskLocalId: id).id(id)
                    .dropDestination(for: URL.self) { urls, _ in attach(urls, to: id) }
            }
            .environment(\.taskOpener, actions.opener)
            .frame(width: 400)
            .frame(maxHeight: .infinity)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.18)))
            .shadow(color: .black.opacity(0.22), radius: 22, x: -4, y: 8)
            .padding(10)
            .transition(.move(edge: .trailing).combined(with: .opacity))
        }
    }

    /// Files dropped on a task's detail are queued as attachments, as the iOS Add file does.
    private func attach(_ urls: [URL], to taskLocalId: String) -> Bool {
        var queued = false
        for url in urls where url.isFileURL {
            guard let data = try? Data(contentsOf: url) else { continue }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            if (try? services.attachFile(taskLocalId: taskLocalId, fileName: url.lastPathComponent, mime: mime, data: data)) != nil {
                queued = true
            }
        }
        return queued
    }
}

/// Screens pushed from a list: a copy of the iOS `RouteDestination`, which lives in the excluded iOS shell.
struct MacRouteDestination: View {
    let route: Route
    let services: AppServices

    var body: some View {
        switch route {
        case .project(let localId):
            let title = (try? services.store.project(localId: localId))?.title ?? "Project"
            ProjectScreen(services: services, projectLocalId: localId, title: title)
        case .favorites:
            TaskListView(services: services, source: .favorites, title: "Favourites")
        case .label(let localId):
            let title = (try? services.store.labels())?.first { $0.localId == localId }?.title ?? "Label"
            TaskListView(services: services, source: .label(localId), title: title)
        case .task(let localId):
            TaskDetailView(services: services, taskLocalId: localId)
        case .inbox:
            InboxScreen(services: services)
        case .savedFilter(let serverId):
            SavedFilterScreen(services: services, serverId: serverId)
        }
    }
}
