import CriaKit
import SwiftUI

struct BrowseData: Equatable, Sendable {
    var projects: [ProjectRecord] = []
    var openCounts: [String: Int] = [:]
    var favouriteCount = 0
}

/// Browse tab: Favourites, then the project tree with colours, task counts, create and edit.
struct BrowseView: View {
    let services: AppServices
    @State private var live: LiveValue<BrowseData>
    @State private var editor: ProjectEditorTarget?
    @State private var pendingDelete: ProjectRecord?
    @AppStorage("cria.projectTree.collapsed") private var collapsedJSON = "[]"

    init(services: AppServices) {
        self.services = services
        let store = services.store
        _live = State(initialValue: LiveValue(initial: BrowseData()) {
            observeStore(store, kinds: [.projects, .tasks]) { reading in
                BrowseData(
                    projects: ProjectTree.visible(try reading.projects()),
                    openCounts: try reading.openTaskCounts(),
                    favouriteCount: try reading.favouriteTaskCount()
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
            }
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
        .navigationTitle("Browse")
        .refreshable { await services.refresh() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New project", systemImage: "plus") { editor = .create }
            }
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

struct ProjectRowView: View {
    let row: ProjectTreeRow
    let openCount: Int
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            if row.hasChildren {
                Button(action: onToggle) {
                    Image(systemName: row.isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption)
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
                        Image(systemName: "star.fill").font(.caption2).foregroundStyle(Color(.warning))
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
