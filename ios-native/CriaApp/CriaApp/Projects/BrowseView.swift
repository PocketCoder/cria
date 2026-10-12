import CriaKit
import SwiftUI

struct BrowseData: Equatable, Sendable {
    var projects: [ProjectRecord] = []
    var openCounts: [String: Int] = [:]
    var favouriteCount = 0
    var savedFilters: [SavedFilterRecord] = []
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
    @AppStorage("cria.projectTree.collapsed") private var collapsedJSON = "[]"

    init(services: AppServices) {
        self.services = services
        let store = services.store
        _live = State(initialValue: LiveValue(initial: BrowseData()) {
            observeStore(store, kinds: [.projects, .tasks, .savedFilters]) { reading in
                BrowseData(
                    projects: ProjectTree.visible(try reading.projects()),
                    openCounts: try reading.openTaskCounts(),
                    favouriteCount: try reading.favouriteTaskCount(),
                    savedFilters: try reading.savedFilters()
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
        }
            .criaSurface()
        .navigationTitle("Browse")
        .quickAdd(services: services)
        .refreshable { await services.refresh() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Add", systemImage: "plus") {
                    Button("New project", systemImage: "folder.badge.plus") { editor = .create }
                    Button("New filter", systemImage: "line.3.horizontal.decrease.circle") {
                        filterEditor = FilterEditorTarget(record: nil)
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
        .confirmationDialog(
            "Delete project and its tasks?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let project = pendingDelete {
                    do {
                        try services.store.deleteProject(localId: project.localId)
                    } catch {
                        fail("Could not delete", error)
                    }
                }
                pendingDelete = nil
            }
        }
        .confirmationDialog(
            "Delete filter?",
            isPresented: Binding(get: { pendingFilterDelete != nil }, set: { if !$0 { pendingFilterDelete = nil } }),
            titleVisibility: .visible, presenting: pendingFilterDelete
        ) { filter in
            Button("Delete", role: .destructive) { Task { await deleteFilter(filter) } }
        } message: { filter in
            Text(filter.title)
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
                    Button("Share") { sharing = ProjectShareTarget(project: row.project) }.tint(Color(.primary))
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

struct FilterEditorTarget: Identifiable {
    let record: SavedFilterRecord?
    var id: Int { record?.serverId ?? 0 }
}

struct ProjectRowView: View {
    let row: ProjectTreeRow
    let openCount: Int
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            if row.hasChildren {
                Button(action: onToggle) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color(.mutedForeground))
                        .rotationEffect(.degrees(row.isExpanded ? 90 : 0))
                        .animation(.spring(duration: 0.24, bounce: 0.25), value: row.isExpanded)
                        .frame(width: 24, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(row.isExpanded ? "Collapse" : "Expand")
            } else {
                Spacer().frame(width: 24)
            }
            NavigationLink(value: Route.project(row.project.localId)) {
                HStack(spacing: 10) {
                    Circle()
                        .fill(Color(hexString: row.project.hexColor) ?? Color(.mutedForeground))
                        .frame(width: 12, height: 12)
                    Text(row.project.title).font(Theme.rowTitle)
                    if row.project.isFavorite {
                        Image(systemName: "star.fill").font(Theme.footnote).foregroundStyle(Color(.warning))
                    }
                    Spacer()
                    if openCount > 0 {
                        Text("\(openCount)").font(Theme.rowTitle).foregroundStyle(Color(.mutedForeground))
                    }
                }
            }
        }
        .padding(.leading, CGFloat(row.depth) * 22)
    }
}
