import CriaKit
import SwiftUI

struct MacSidebarData: Equatable, Sendable {
    /// Visible projects by parent (nil = roots), built once per read rather than twice per project per render.
    var children: [String?: [ProjectRecord]] = [:]
    var favourites: [ProjectRecord] = []
    var filters: [SavedFilterRecord] = []
    var counts = TabCounts()
    /// Changes waiting in the outbox, for the footer.
    var waiting = 0
}

/// The sidebar from the macOS design: Inbox, Today and Upcoming, then collapsible Favourites, Projects and Filters,
/// with sync status and Settings in the footer. Search is the toolbar's field, not a row. Icons take the accent
/// colour; counts show on the right when Settings > Customise > Show task count is on. The system draws the glass on
/// macOS 26; no background.
struct MacSidebar: View {
    let services: AppServices
    let actions: MacActions
    @State private var live: LiveValue<MacSidebarData>
    @Environment(\.preferences) private var preferences
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false
    @AppStorage("mac.sidebar.favourites") private var showFavourites = true
    @AppStorage("mac.sidebar.projects") private var showProjects = true
    @AppStorage("mac.sidebar.filters") private var showFilters = true

    private var sheets: MacSidebarActions { actions.sidebar }

    init(services: AppServices, actions: MacActions) {
        self.services = services
        self.actions = actions
        let store = services.store
        _live = State(initialValue: LiveValue(initial: MacSidebarData()) {
            observeStore(store, kinds: [.projects, .tasks, .savedFilters, .outbox]) { (reading: CriaStore) throws -> MacSidebarData in
                let visible = ProjectTree.visible(try reading.projects())
                return MacSidebarData(
                    children: ProjectTree.childIndex(visible),
                    favourites: visible.filter(\.isFavorite),
                    filters: try reading.savedFilters(),
                    counts: try TabCounts.read(reading, inboxLocalId: services.rememberedDefaultProjectLocalId()),
                    waiting: try reading.outboxRows().count
                )
            }
        })
    }

    var body: some View {
        List(selection: selection) {
            row(.inbox, .inbox, count: live.value.counts.inbox)
            row(.today, .today, count: live.value.counts.today)
            row(.upcoming, .upcoming)
            Section(isExpanded: $showFavourites) {
                Label("Starred", systemImage: "star").tag(MacSelection.favorites)
                ForEach(live.value.favourites, id: \.localId) { project in
                    MacProjectLabel(project: project, services: services, sheets: sheets)
                }
            } header: {
                header("Favourites")
            }
            Section(isExpanded: $showProjects) {
                MacProjectBranch(parent: nil, children: live.value.children, services: services, sheets: sheets)
            } header: {
                header("Projects", add: "New project") { actions.creatingProject = true }
            }
            // Shown when empty too, so its + is where a first filter is made. A share link has no saved filters.
            if !isLinkShare {
                Section(isExpanded: $showFilters) {
                    ForEach(live.value.filters, id: \.serverId) { filter in
                        Label(filter.title, systemImage: "line.3.horizontal.decrease")
                            .tag(MacSelection.savedFilter(filter.serverId))
                            .contextMenu {
                                Button("Edit…", systemImage: "pencil") { sheets.filterEditor = FilterEditorTarget(record: filter) }
                                Button("Delete…", systemImage: "trash", role: .destructive) { sheets.pendingFilterDelete = filter }
                            }
                    }
                } header: {
                    header("Filters", add: "New saved filter") { sheets.newFilter() }
                }
            }
        }
        .tint(Color(.primary))
        .navigationSplitViewColumnWidth(min: 200, ideal: 244)
        .task { await live.run() }
        .safeAreaInset(edge: .bottom, spacing: 0) { footer }
    }

    /// Sync status and the Settings gear, under a hairline.
    private var footer: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 6) {
                if live.value.waiting > 0 {
                    Label(Self.waitingText(live.value.waiting), systemImage: "icloud.slash")
                } else {
                    Label("Synced", systemImage: "checkmark.icloud")
                }
                Spacer(minLength: 4)
                SettingsLink { Image(systemName: "gearshape") }
                    .buttonStyle(.borderless)
                    .help("Settings")
                    .accessibilityLabel("Settings")
            }
            .font(.system(size: 12))
            .foregroundStyle(MacTheme.label2)
            .lineLimit(1)
            .padding(.horizontal, 14)
            .frame(height: 40)
        }
    }

    static func waitingText(_ count: Int) -> String {
        count == 1 ? "1 change waiting to sync" : "\(count) changes waiting to sync"
    }

    /// A section heading: SF 11 semibold in the tertiary shade, with an optional + on the right.
    private func header(_ title: String, add help: String? = nil, action: (() -> Void)? = nil) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(MacTheme.label3)
            Spacer()
            if let help, let action {
                Button(action: action) {
                    Image(systemName: "plus").frame(width: 20, height: 20).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(MacTheme.label2)
                .help(help)
                .accessibilityLabel(help)
            }
        }
    }

    /// A click on empty space or a ⌘-click would clear the selection, leaving no row lit while Today shows; ignore it.
    private var selection: Binding<MacSelection?> {
        Binding(get: { actions.selection }, set: { newValue in
            if let newValue { actions.selection = newValue }
        })
    }

    private func row(_ tab: AppTab, _ destination: MacSelection, count: Int = 0) -> some View {
        HStack {
            Label(tab.title, systemImage: tab.symbol)
            Spacer()
            if preferences.custom.showTaskCount, count > 0 {
                Text("\(count)").font(.system(size: 12)).foregroundStyle(MacTheme.label2).monospacedDigit()
            }
        }
        .tag(destination)
    }
}

/// One level of the project tree; parents with sub-projects expand with a disclosure triangle. Rows drag to reorder
/// among their siblings, and right-click for Browse's project actions.
struct MacProjectBranch: View {
    let parent: String?
    let children: [String?: [ProjectRecord]]
    let services: AppServices
    let sheets: MacSidebarActions

    var body: some View {
        let siblings = children[parent] ?? []
        ForEach(siblings, id: \.localId) { project in
            if children[project.localId]?.isEmpty ?? true {
                label(project)
            } else {
                DisclosureGroup {
                    MacProjectBranch(parent: project.localId, children: children, services: services, sheets: sheets)
                } label: {
                    label(project)
                }
            }
        }
        .onMove { source, destination in sheets.move(siblings, from: source, to: destination, services: services) }
    }

    private func label(_ project: ProjectRecord) -> some View {
        MacProjectLabel(project: project, services: services, sheets: sheets)
    }
}

/// A project row: its colour dot, title and the project actions on right-click.
struct MacProjectLabel: View {
    let project: ProjectRecord
    let services: AppServices
    let sheets: MacSidebarActions

    var body: some View {
        Label {
            Text(project.title)
        } icon: {
            Image(systemName: "circle.fill")
                .font(.system(size: 10))
                .foregroundStyle(Color(hexString: project.hexColor) ?? MacTheme.label2)
        }
        .tag(MacSelection.project(project.localId))
        // On the row itself, not the disclosure group, so a sub-project's menu is its own.
        .contextMenu { MacProjectMenu(project: project, services: services, sheets: sheets) }
    }
}
