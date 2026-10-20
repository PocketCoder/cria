import CriaKit
import SwiftUI

/// Signed-in shell: four tabs, each with its own navigation stack. On iOS 26 the system draws the glass tab
/// bar for a plain `TabView`; older versions get the standard bar.
struct ShellView: View {
    let services: AppServices
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @Binding var pendingURL: URL?
    @State private var navigation = NavigationModel()
    @State private var addRequest: QuickAddRequest?
    @State private var showingPalette = false
    @State private var conflictPrompt = ConflictPrompt()
    @State private var undoCenter = UndoCenter()
    @State private var inbox = NotificationInbox()
    @Environment(\.scenePhase) private var scenePhase
    /// A share link has no account, so no notifications to poll.
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false
    @State private var counts: LiveValue<TabCounts>
    @Environment(\.preferences) private var preferences

    init(services: AppServices, onSignOut: @escaping (_ wipeLocalData: Bool) -> Void, pendingURL: Binding<URL?>) {
        self.services = services
        self.onSignOut = onSignOut
        _pendingURL = pendingURL
        let store = services.store
        _counts = State(initialValue: LiveValue(initial: TabCounts()) {
            // The inbox id is read on each change: on a first launch it arrives with the first server read.
            observeStore(store, kinds: [.tasks, .projects]) { reading in
                try TabCounts.read(reading, inboxLocalId: services.rememberedDefaultProjectLocalId())
            }
        })
    }

    private var custom: Customisation { preferences.custom }

    var body: some View {
        // An inset, not a VStack: a view stacked above the TabView kept its navigation bars off the top edge, which
        // left an empty band above every large title. An empty banner is zero high, so the inset is zero too.
        tabs
            .safeAreaInset(edge: .top, spacing: 0) {
                SyncBanner(services: services, conflicts: conflictPrompt)
            }
            .overlay(alignment: .bottom) { UndoToast(center: undoCenter) }
            .environment(navigation)
            .environment(undoCenter)
            .environment(inbox)
            .tint(Color(.primary))
            .onChange(of: pendingURL) { _, _ in openPendingURL() }
            .task {
                // The home view first, so a link that opened the app still wins.
                navigation.state.selected = custom.launchTab
                openPendingURL()
            }
            .task { await counts.run() }
            .onChange(of: custom.barTabs) { _, tabs in
                if !tabs.contains(navigation.state.selected) { navigation.state.selected = custom.launchTab }
            }
            .task { await conflictPrompt.run(store: services.store) }
            .task { undoCenter.attach(services) }
            // Every 30 s while the app is active; the task restarts (and reads at once) when it comes back.
            .task(id: scenePhase) {
                if scenePhase == .active && !isLinkShare { await inbox.poll(services) }
            }
            .modifier(IPadShortcuts(
                onPalette: { showingPalette = true }, onNewTask: { addRequest = QuickAddRequest(title: "") }, onGo: jump
            ))
            .sheet(isPresented: $showingPalette) {
                IOSCommandPalette(services: services, onChoose: choose)
            }
            .sheet(item: $addRequest) { request in
                QuickAddSheet(services: services, contextProjectId: nil, initialLine: request.title)
            }
            .sheet(
                isPresented: $conflictPrompt.isPresented,
                onDismiss: { conflictPrompt.sheetDismissed() },
                content: { ConflictSheet(services: services, prompt: conflictPrompt) }
            )
    }

    /// The tabs from Settings > Customise > Navigation, then Browse, plus a search-role tab: on iOS 26 the system
    /// detaches Search into its own glass circle. Tab needs iOS 18; iOS 17 keeps the plain tab items.
    @ViewBuilder private var tabs: some View {
        let shown = custom.barTabs.filter { $0 != .search }
        if #available(iOS 18, *) {
            TabView(selection: navigation.selection) {
                ForEach(shown, id: \.self) { tab in
                    Tab(tab.title, systemImage: tab.symbol, value: tab) { stack(tab) }
                        .badge(badge(for: tab))
                }
                Tab(AppTab.search.title, systemImage: AppTab.search.symbol, value: AppTab.search, role: .search) {
                    stack(.search)
                }
            }
            .modifier(KeepTabBarVisible())
        } else {
            TabView(selection: navigation.selection) {
                ForEach(shown + [.search], id: \.self) { tab in
                    stack(tab)
                        .tabItem { Label(tab.title, systemImage: tab.symbol) }
                        .tag(tab)
                        .badge(badge(for: tab))
                }
            }
        }
    }

    /// Open tasks due today or earlier on Today, open tasks on Inbox; nothing when counts are off.
    private func badge(for tab: AppTab) -> Int {
        guard custom.showTaskCount else { return 0 }
        switch tab {
        case .today: return counts.value.today
        case .inbox: return counts.value.inbox
        default: return 0
        }
    }

    /// Acts on a link that arrived from outside (widget, Spotlight, Shortcuts) and clears it.
    private func openPendingURL() {
        guard let url = pendingURL else { return }
        pendingURL = nil
        guard let link = DeepLink(url: url), let destination = try? link.destination(in: services.store) else { return }
        switch destination {
        // A tab left out of the bar opens through Browse.
        case .open(let tab, let route?) where !custom.barTabs.contains(tab):
            navigation.state.open(route, on: .browse)
        case .open(let tab, nil) where !custom.barTabs.contains(tab):
            navigation.state.selected = .browse
        case .open(let tab, let route?):
            navigation.state.open(route, on: tab)
        case .open(let tab, nil):
            navigation.state.selected = tab
            navigation.state.setPath([], for: tab)
        case .quickAdd(let title):
            addRequest = QuickAddRequest(title: title ?? "")
        }
    }

    /// Opens a tab's first screen (a tab left out of the bar opens through Browse), as a link to it would.
    private func jump(to tab: AppTab) {
        let target: AppTab = custom.barTabs.contains(tab) || tab == .search ? tab : .browse
        if target == tab {
            navigation.state.selected = tab
            navigation.state.setPath([], for: tab)
        } else if tab == .inbox {
            navigation.state.open(.inbox, on: .browse)
        } else if tab == .favorites {
            navigation.state.open(.favorites, on: .browse)
        } else {
            navigation.state.selected = .browse
        }
    }

    /// What a command palette row asked for.
    private func choose(_ choice: IOSCommandPalette.Choice) {
        switch choice {
        case .go(let tab): jump(to: tab)
        case .project(let localId): navigation.state.open(.project(localId), on: .browse)
        case .task(let localId): navigation.state.push(.task(localId))
        case .newTask: addRequest = QuickAddRequest(title: "")
        }
    }

    private func stack(_ tab: AppTab) -> some View {
        NavigationStack(path: navigation.pathBinding(for: tab)) {
            TabRoot(tab: tab, services: services, onSignOut: onSignOut)
                .navigationDestination(for: Route.self) { route in
                    RouteDestination(route: route, services: services)
                }
        }
    }
}

/// Keeps the tab bar visible on iOS 26 so the floating + button has a stable anchor.
private struct KeepTabBarVisible: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.tabBarMinimizeBehavior(.never)
        } else {
            content
        }
    }
}

/// Root screen of each tab. 
struct TabRoot: View {
    let tab: AppTab
    let services: AppServices
    let onSignOut: (_ wipeLocalData: Bool) -> Void
    @State private var showingSettings = false

    var body: some View {
        switch tab {
        case .browse:
            BrowseView(services: services)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Settings", systemImage: "gearshape") { showingSettings = true }
                    }
                    ToolbarItem(placement: .topBarLeading) { NotificationBell(services: services) }
                }
                .sheet(isPresented: $showingSettings) {
                    SettingsView(services: services, onSignOut: onSignOut)
                }
        case .today:
            SmartViewScreen(services: services, view: .today, title: "Today")
                .toolbar { ToolbarItem(placement: .topBarLeading) { NotificationBell(services: services) } }
        case .upcoming:
            SmartViewScreen(services: services, view: .upcoming, title: "Upcoming")
                .toolbar { ToolbarItem(placement: .topBarLeading) { NotificationBell(services: services) } }
        case .search:
            SearchScreen(services: services)
        case .inbox:
            InboxScreen(services: services)
        case .favorites:
            TaskListView(services: services, source: .favorites, title: "Favourites")
        }
    }
}

/// Screens pushed from a tab. 
struct RouteDestination: View {
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
