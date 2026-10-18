import CriaKit
import SwiftUI

struct MacSidebarData: Equatable, Sendable {
    /// Visible projects by parent (nil = roots), built once per read rather than twice per project per render.
    var children: [String?: [ProjectRecord]] = [:]
    var favourites: [ProjectRecord] = []
    var filters: [SavedFilterRecord] = []
    var labels: [LabelRecord] = []
}

/// The sidebar from the macOS design: Inbox, Today and Upcoming, then collapsible Favourites, Projects, Filters and Labels,
/// with sync status and Settings in the footer. Search is the toolbar's field, not a row. Icons take the accent
/// colour; counts show on the right when Settings > Customise > Show task count is on. The system draws the glass on
/// macOS 26; no background.
struct MacSidebar: View {
    let services: AppServices
    let actions: MacActions
    /// The tree, filters and labels: re-read only when those change, not on every task edit.
    @State private var live: LiveValue<MacSidebarData>
    /// The Inbox and Today counts, on task changes.
    @State private var counts: LiveValue<TabCounts>
    @Environment(\.preferences) private var preferences
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false
    @AppStorage("mac.sidebar.favourites") private var showFavourites = true
    @AppStorage("mac.sidebar.projects") private var showProjects = true
    @AppStorage("mac.sidebar.filters") private var showFilters = true
    @AppStorage("mac.sidebar.labels") private var showLabels = true

    private var sheets: MacSidebarActions { actions.sidebar }

    init(services: AppServices, actions: MacActions) {
        self.services = services
        self.actions = actions
        let store = services.store
        _live = State(initialValue: LiveValue(initial: MacSidebarData()) {
            observeStore(store, kinds: [.projects, .savedFilters, .labels]) { (reading: CriaStore) throws -> MacSidebarData in
                let visible = ProjectTree.visible(try reading.projects())
                return MacSidebarData(
                    children: ProjectTree.childIndex(visible),
                    favourites: visible.filter(\.isFavorite),
                    filters: try reading.savedFilters(),
                    labels: try reading.labels()
                )
            }
        })
        _counts = State(initialValue: LiveValue(initial: TabCounts()) {
            observeStore(store, kinds: [.tasks, .projects]) { (reading: CriaStore) throws -> TabCounts in
                let today = try reading.smartGroups(.today).reduce(0) { $0 + $1.items.count }
                // A plain count, without the row data (labels, summaries) a list read builds.
                let inbox = try services.rememberedDefaultProjectLocalId().map {
                    try reading.tasks(matching: TaskQuery(projectLocalId: $0, includeDone: false)).count
                } ?? 0
                return TabCounts(today: today, inbox: inbox)
            }
        })
    }

    var body: some View {
        List(selection: selection) {
            row(.inbox, .inbox, count: counts.value.inbox)
            row(.today, .today, count: counts.value.today)
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
            Section(isExpanded: $showLabels) {
                ForEach(live.value.labels, id: \.localId) { label in
                    Label {
                        Text(label.title)
                    } icon: {
                        Image(systemName: "tag.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(Color(hexString: label.hexColor) ?? MacTheme.label2)
                    }
                    .tag(MacSelection.label(label.localId))
                    .contextMenu {
                        Button("Edit…", systemImage: "pencil") { sheets.labelEditor = LabelEditTarget(label: label) }
                        Button("Delete…", systemImage: "trash", role: .destructive) {
                            sheets.askToDelete(label, services: services)
                        }
                    }
                }
            } header: {
                header("Labels", add: "Manage labels") { sheets.showingLabels = true }
            }
        }
        .tint(Color(.primary))
        .navigationSplitViewColumnWidth(min: 200, ideal: 244)
        .task { await live.run() }
        .task { await counts.run() }
        .safeAreaInset(edge: .bottom, spacing: 0) { MacSidebarFooter(store: services.store) }
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

/// A project row: its colour dot, title and the project actions on right-click. A task dragged from a list drops on it
/// to move there, with a 22% tint and a 1.5pt accent ring while it is over the row.
struct MacProjectLabel: View {
    let project: ProjectRecord
    let services: AppServices
    let sheets: MacSidebarActions
    @State private var isTargeted = false

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
        .background {
            if isTargeted {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(.primary).opacity(0.22))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color(.primary), lineWidth: 1.5))
                    .padding(.horizontal, -8)
                    .padding(.vertical, -4)
            }
        }
        .dropDestination(for: String.self) { items, _ in
            moveTasks(items.compactMap(KanbanPayload.taskId(from:)))
        } isTargeted: { isTargeted = $0 }
    }

    /// Moves each dropped task here, as the inspector's Move to project does. Tasks already here are left alone.
    private func moveTasks(_ ids: [String]) -> Bool {
        var moved = false
        for id in ids {
            guard let task = try? services.store.task(localId: id), task.projectLocalId != project.localId else { continue }
            var patch = TaskPatch()
            patch.projectLocalId = project.localId
            if (try? services.store.updateTask(localId: id, patch: patch)) != nil { moved = true }
        }
        return moved
    }
}

/// Sync status and the Settings gear, under a hairline. Its own view on its own count, so the outbox filling and
/// draining redraws only this line.
private struct MacSidebarFooter: View {
    @State private var waiting: LiveValue<Int>

    init(store: CriaStore) {
        _waiting = State(initialValue: LiveValue(initial: 0) {
            observeStore(store, kinds: [.outbox]) { try $0.outboxCount() }
        })
    }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 6) {
                if waiting.value > 0 {
                    Label(Self.waitingText(waiting.value), systemImage: "icloud.slash")
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
        .task { await waiting.run() }
    }

    static func waitingText(_ count: Int) -> String {
        count == 1 ? "1 change waiting to sync" : "\(count) changes waiting to sync"
    }
}
