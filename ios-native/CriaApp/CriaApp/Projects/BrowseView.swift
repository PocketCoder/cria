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

    private var collapsed: Set<String> { ProjectTree.decodeCollapsed(collapsedJSON) }

    private func toggle(_ localId: String) {
        collapsedJSON = ProjectTree.encodeCollapsed(ProjectTree.toggled(localId, in: collapsed))
    }

    var body: some View {
        List {
            Section {
                NavigationLink(value: Route.favorites) {
                    Label("Favourites", systemImage: "star.fill")
                        .badge(live.value.favouriteCount)
                }
                NavigationLink(value: Route.inbox) {
                    Label("Inbox", systemImage: "tray")
                }
            }
            filtersSection
            projectsSection
        }
            .criaSurface()
        .navigationTitle("Browse")
        .refreshable { await services.refresh() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Add", systemImage: "plus") {
                    Button("New project", systemImage: "folder.badge.plus") { editor = .create }
                    Button("New filter", systemImage: "line.3.horizontal.decrease.circle") {
                        filterEditor = FilterEditorTarget(record: nil)
                    }
                }
            }
        }
        .sheet(item: $filterEditor) { target in
            FilterEditorSheet(services: services, existing: target.record)
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
                if let project = pendingDelete { try? services.store.deleteProject(localId: project.localId) }
                pendingDelete = nil
            }
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
                .swipeActions(edge: .trailing) {
                    Button("Delete", role: .destructive) { pendingDelete = row.project }
                    Button("Edit") { editor = .edit(row.project) }.tint(Color(.info))
                }
                .swipeActions(edge: .leading) {
                    Button(row.project.isFavorite ? "Unfavourite" : "Favourite", systemImage: "star") {
                        try? services.store.setProjectFavorite(localId: row.project.localId, isFavorite: !row.project.isFavorite)
                    }
                    .tint(Color(.warning))
                }
            }
        }
    }

    @ViewBuilder var filtersSection: some View {
        if !live.value.savedFilters.isEmpty {
            Section("Filters") {
                ForEach(live.value.savedFilters, id: \.serverId) { filter in
                    NavigationLink(value: Route.savedFilter(filter.serverId)) {
                        Label(filter.title, systemImage: "line.3.horizontal.decrease.circle")
                    }
                    .swipeActions(edge: .trailing) {
                        Button("Delete", role: .destructive) {
                            Task { try? await services.deleteSavedFilter(serverId: filter.serverId) }
                        }
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
                    Image(systemName: row.isExpanded ? "chevron.down" : "chevron.right")
                        .font(Theme.caption)
                        .frame(width: 20)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(row.isExpanded ? "Collapse" : "Expand")
            } else {
                Spacer().frame(width: 20)
            }
            NavigationLink(value: Route.project(row.project.localId)) {
                HStack {
                    Circle()
                        .fill(Color(hexString: row.project.hexColor) ?? Color(.mutedForeground))
                        .frame(width: 10, height: 10)
                    Text(row.project.title).font(Theme.rowTitle)
                    if row.project.isFavorite {
                        Image(systemName: "star.fill").font(Theme.footnote).foregroundStyle(Color(.warning))
                    }
                    Spacer()
                    if openCount > 0 {
                        Text("\(openCount)").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                    }
                }
            }
        }
        .padding(.leading, CGFloat(row.depth) * 16)
    }
}
