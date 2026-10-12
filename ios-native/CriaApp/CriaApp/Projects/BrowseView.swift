import CriaKit
import SwiftUI

struct BrowseData: Equatable, Sendable {
    var projects: [ProjectRecord] = []
    var openCounts: [String: Int] = [:]
    var favouriteCount = 0
    var savedFilters: [SavedFilterRecord] = []
    var labels: [LabelRecord] = []
    var labelCounts: [String: Int] = [:]
}

/// Browse tab: Favourites, then the project tree with colours, task counts, create and edit.
struct BrowseView: View {
    let services: AppServices
    @State var live: LiveValue<BrowseData>
    @State private var editor: ProjectEditorTarget?
    @State private var pendingDelete: ProjectRecord?
    @State private var sharing: ProjectShareTarget?
    @State private var failure: String?
    @State private var failureTitle = "Could not delete"
    @State private var pendingFilterDelete: SavedFilterRecord?
    @State private var showRamble = false
    @State private var showPhoto = false
    private var aiStatus: AIStatus { AIStatus.shared }
    @State var filterEditor: FilterEditorTarget?
    @State private var labelEditor: LabelEditTarget?
    @State private var pendingLabelDelete: LabelDeleteTarget?
    @AppStorage("cria.projectTree.collapsed") private var collapsedJSON = "[]"
    /// A share link has no account: no sharing or saved filters, which the server would refuse.
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false

    init(services: AppServices) {
        self.services = services
        let store = services.store
        _live = State(initialValue: LiveValue(initial: BrowseData()) {
            observeStore(store, kinds: [.projects, .tasks, .savedFilters, .labels]) { reading in
                BrowseData(
                    projects: ProjectTree.visible(try reading.projects()),
                    openCounts: try reading.openTaskCounts(),
                    favouriteCount: try reading.favouriteTaskCount(),
                    savedFilters: try reading.savedFilters(),
                    labels: try reading.labels(),
                    labelCounts: try reading.openTaskCountsByLabel()
                )
            }
        })
    }

    /// Saved filters live on the server only, so deleting one needs the network; say so when it fails.
    private func deleteFilter(_ filter: SavedFilterRecord) async {
        do {
            try await services.deleteSavedFilter(serverId: filter.serverId)
        } catch {
            fail("Could not delete", error)
        }
    }

    private func fail(_ title: String, _ error: any Error) {
        failureTitle = title
        failure = String(describing: error)
    }

    private var collapsed: Set<String> { ProjectTree.decodeCollapsed(collapsedJSON) }

    private func toggle(_ localId: String) {
        collapsedJSON = ProjectTree.encodeCollapsed(ProjectTree.toggled(localId, in: collapsed))
    }

    var body: some View {
        List {
            Section {
                NavigationLink(value: Route.inbox) {
                    Label { Text("Inbox") } icon: { Image(systemName: "tray").foregroundStyle(Color(.sky500)) }
                }
                NavigationLink(value: Route.favorites) {
                    Label { Text("Favourites") } icon: { Image(systemName: "star.fill").foregroundStyle(Color(.marigold500)) }
                        .badge(live.value.favouriteCount)
                }
            }
            filtersSection
            projectsSection
            labelsSection
        }
            .criaSurface()
        .navigationTitle("Browse")
        .quickAdd(services: services)
        .refreshable { await services.refresh() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Add", systemImage: "plus") {
                    Button("New project", systemImage: "folder.badge.plus") { editor = .create }
                    if !isLinkShare {
                        Button("New filter", systemImage: "line.3.horizontal.decrease.circle") {
                            filterEditor = FilterEditorTarget(record: nil)
                        }
                    }
                    Divider()
                    Button("List from photo", systemImage: "camera.viewfinder") { showPhoto = true }
                    if aiStatus.isOfferable {
                        Button("Ramble to tasks", systemImage: "mic") { showRamble = true }
                            .disabled(aiStatus.notReadyMessage != nil)
                    }
                }
            }
        }
        .sheet(item: $filterEditor) { target in
            FilterEditorSheet(services: services, existing: target.record)
        }
        .sheet(item: $labelEditor) { target in
            LabelEditorSheet(services: services, label: target.label)
        }
        .task { await aiStatus.refresh() }
        .alert(failureTitle, isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
        .sheet(isPresented: $showRamble) { RambleSheet(services: services) }
        .sheet(isPresented: $showPhoto) { ShoppingPhotoSheet(services: services) }
        .sheet(item: $sharing) { target in
            ProjectSharingSheet(services: services, project: target.project)
        }
        .sheet(item: $editor) { target in
            ProjectEditorSheet(services: services, target: target, projects: live.value.projects)
        }
        // Alerts, not confirmation dialogs: on iOS 26 those are popovers, anchored away from the swiped row.
        .alert(
            "Delete project and its tasks?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            presenting: pendingDelete
        ) { project in
            Button("Delete", role: .destructive) {
                do {
                    try services.store.deleteProject(localId: project.localId)
                } catch {
                    fail("Could not delete", error)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { project in
            Text(project.title)
        }
        .alert(
            "Delete filter?",
            isPresented: Binding(get: { pendingFilterDelete != nil }, set: { if !$0 { pendingFilterDelete = nil } }),
            presenting: pendingFilterDelete
        ) { filter in
            Button("Delete", role: .destructive) { Task { await deleteFilter(filter) } }
            Button("Cancel", role: .cancel) {}
        } message: { filter in
            Text(filter.title)
        }
        .alert(
            "Delete label?",
            isPresented: Binding(get: { pendingLabelDelete != nil }, set: { if !$0 { pendingLabelDelete = nil } }),
            presenting: pendingLabelDelete
        ) { target in
            Button("Delete", role: .destructive) { deleteLabel(target.label) }
            Button("Cancel", role: .cancel) {}
        } message: { target in
            Text(target.message)
        }
        .task { await live.run() }
    }
}

extension BrowseView {
    @ViewBuilder var projectsSection: some View {
        Section("Projects") {
            ForEach(ProjectTree.rows(live.value.projects, collapsed: collapsed), id: \.project.localId) { row in
                ProjectRowView(
                    row: row,
                    openCount: live.value.openCounts[row.project.localId] ?? 0,
                    onToggle: { toggle(row.project.localId) }
                )
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    // Not `.destructive`: that role animates the row away even when the confirmation is cancelled.
                    Button("Delete") { pendingDelete = row.project }.tint(Color(.destructive))
                    Button("Edit") { editor = .edit(row.project) }.tint(Color(.sky500))
                    if !isLinkShare {
                        Button("Share") { sharing = ProjectShareTarget(project: row.project) }.tint(Color(.primary))
                    }
                }
                .swipeActions(edge: .leading) {
                    Button(row.project.isFavorite ? "Unfavourite" : "Favourite", systemImage: "star") {
                        do {
                            try services.store.setProjectFavorite(localId: row.project.localId, isFavorite: !row.project.isFavorite)
                        } catch {
                            fail("Could not save", error)
                        }
                    }
                    .tint(Color(.marigold500))
                }
            }
        }
    }

    /// Labels, styled like projects: colour dot, title, open count.
    @ViewBuilder var labelsSection: some View {
        if !live.value.labels.isEmpty {
            Section("Labels") {
                ForEach(live.value.labels, id: \.localId) { label in
                    NavigationLink(value: Route.label(label.localId)) {
                        HStack(spacing: 8) {
                            Label {
                                Text(label.title).font(Theme.rowTitle)
                            } icon: {
                                Image(systemName: "tag.fill")
                                    .font(.footnote)
                                    .foregroundStyle(Color(hexString: label.hexColor) ?? Color(.mutedForeground))
                                    .accessibilityHidden(true)
                            }
                            Spacer(minLength: 0)
                            if let count = live.value.labelCounts[label.localId], count > 0 {
                                Text("\(count)").font(Theme.rowTitle).foregroundStyle(Color(.mutedForeground))
                            }
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        // Not `.destructive`: that role animates the row away even when the confirmation is cancelled.
                        Button("Delete") { askToDelete(label) }.tint(Color(.destructive))
                        Button("Edit") { labelEditor = LabelEditTarget(label: label) }.tint(Color(.sky500))
                    }
                    .contextMenu {
                        Button("Edit", systemImage: "pencil") { labelEditor = LabelEditTarget(label: label) }
                        Button("Delete", systemImage: "trash", role: .destructive) { askToDelete(label) }
                    }
                }
            }
        }
    }

    /// Labels have no undo, so the confirmation says how many tasks lose it (open and done).
    func askToDelete(_ label: LabelRecord) {
        let count = (try? services.store.taskCount(forLabel: label.localId)) ?? live.value.labelCounts[label.localId] ?? 0
        pendingLabelDelete = LabelDeleteTarget(label: label, taskCount: count)
    }

    func deleteLabel(_ label: LabelRecord) {
        do {
            try services.store.deleteLabel(localId: label.localId)
        } catch {
            fail("Could not delete", error)
        }
    }

    @ViewBuilder var filtersSection: some View {
        if !live.value.savedFilters.isEmpty {
            Section("Filters") {
                ForEach(live.value.savedFilters, id: \.serverId) { filter in
                    NavigationLink(value: Route.savedFilter(filter.serverId)) {
                        Label { Text(filter.title) } icon: {
                            Image(systemName: "line.3.horizontal.decrease.circle").foregroundStyle(Color(.primary))
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button("Delete") { pendingFilterDelete = filter }.tint(Color(.destructive))
                        Button("Edit") { filterEditor = FilterEditorTarget(record: filter) }.tint(Color(.info))
                    }
                }
            }
        }
    }
}

/// A label waiting for delete confirmation, with how many tasks carry it.
struct LabelDeleteTarget {
    let label: LabelRecord
    let taskCount: Int

    var message: String {
        let name = "\u{201C}\(label.title)\u{201D}"
        switch taskCount {
        case 0: return "No tasks carry \(name). This cannot be undone."
        case 1: return "\(name) will be removed from 1 task. This cannot be undone."
        default: return "\(name) will be removed from \(taskCount) tasks. This cannot be undone."
        }
    }
}

struct FilterEditorTarget: Identifiable {
    let record: SavedFilterRecord?
    var id: Int { record?.serverId ?? 0 }
}

/// A project in the tree. The colour dot sits in the label's icon column, so a root project lines up with Inbox and
/// Favourites; children indent by depth only. The expand chevron sits at the trailing end.
struct ProjectRowView: View {
    let row: ProjectTreeRow
    let openCount: Int
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            NavigationLink(value: Route.project(row.project.localId)) {
                HStack(spacing: 8) {
                    Label {
                        Text(row.project.title).font(Theme.rowTitle)
                    } icon: {
                        Circle()
                            .fill(Color(hexString: row.project.hexColor) ?? Color(.mutedForeground))
                            .frame(width: 12, height: 12)
                    }
                    if row.project.isFavorite {
                        Image(systemName: "star.fill").font(Theme.footnote).foregroundStyle(Color(.warning))
                    }
                    Spacer(minLength: 0)
                    if openCount > 0 {
                        Text("\(openCount)").font(Theme.rowTitle).foregroundStyle(Color(.mutedForeground))
                    }
                }
            }
            if row.hasChildren { toggle }
        }
        .padding(.leading, CGFloat(row.depth) * 22)
    }

    /// Beside the link, not inside it, so a tap here expands or collapses instead of opening the project.
    private var toggle: some View {
        Button(action: onToggle) {
            Image(systemName: "chevron.down")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color(.mutedForeground))
                .rotationEffect(.degrees(row.isExpanded ? 180 : 0))
                .animation(.spring(duration: 0.24, bounce: 0.25), value: row.isExpanded)
                .frame(width: 32, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(row.isExpanded ? "Collapse \(row.project.title)" : "Expand \(row.project.title)")
    }
}
