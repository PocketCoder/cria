import CriaKit
import SwiftUI

enum MacSelection: Hashable {
    case inbox, today, upcoming
    case project(String)
}

/// Sidebar, task list and a detail column that only shows the title for now.
struct MacShellView: View {
    let services: AppServices
    let onSignOut: () -> Void
    @State private var selection: MacSelection? = .today
    @State private var taskId: String?
    @State private var projects: LiveValue<[ProjectTreeRow]>

    init(services: AppServices, onSignOut: @escaping () -> Void) {
        self.services = services
        self.onSignOut = onSignOut
        let store = services.store
        _projects = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.projects]) { (reading: CriaStore) throws -> [ProjectTreeRow] in
                ProjectTree.rows(ProjectTree.visible(try reading.projects()))
            }
        })
    }

    var body: some View {
        NavigationSplitView {
            sidebar
        } content: {
            if let selection {
                MacTaskListView(services: services, selection: selection, taskId: $taskId)
                    .id(selection)
            } else {
                ContentUnavailableView("Select a list", systemImage: "sidebar.left")
            }
        } detail: {
            MacTaskDetailView(services: services, taskId: taskId)
        }
        .task { await projects.run() }
        .onChange(of: selection) { taskId = nil }
    }

    private var sidebar: some View {
        List(selection: $selection) {
            Label("Inbox", systemImage: "tray").tag(MacSelection.inbox)
            Label("Today", systemImage: "sun.max").tag(MacSelection.today)
            Label("Upcoming", systemImage: "calendar").tag(MacSelection.upcoming)
            Section("Projects") {
                ForEach(projects.value, id: \.project.localId) { row in
                    Label(row.project.title, systemImage: "folder")
                        .padding(.leading, CGFloat(row.depth) * 12)
                        .tag(MacSelection.project(row.project.localId))
                }
            }
        }
        .navigationSplitViewColumnWidth(min: 180, ideal: 220)
        .safeAreaInset(edge: .bottom) {
            Button("Sign out", action: onSignOut).buttonStyle(.link).padding(8)
        }
    }
}
