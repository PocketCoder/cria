import CriaKit
import SwiftUI

struct MacSidebarData: Equatable, Sendable {
    var projects: [ProjectRecord] = []
    var filters: [SavedFilterRecord] = []
    var counts = TabCounts()
}

/// Inbox, Today, Upcoming, Favourites and Search, then the project tree, then saved filters. Counts show on the
/// right when Settings > Customise > Show task count is on. The system draws the glass on macOS 26; no background.
struct MacSidebar: View {
    let services: AppServices
    @Bindable var actions: MacActions
    @State private var live: LiveValue<MacSidebarData>
    @Environment(\.preferences) private var preferences

    init(services: AppServices, actions: MacActions) {
        self.services = services
        self.actions = actions
        let store = services.store
        _live = State(initialValue: LiveValue(initial: MacSidebarData()) {
            observeStore(store, kinds: [.projects, .tasks, .savedFilters]) { (reading: CriaStore) throws -> MacSidebarData in
                MacSidebarData(
                    projects: ProjectTree.visible(try reading.projects()),
                    filters: try reading.savedFilters(),
                    counts: try TabCounts.read(reading, inboxLocalId: services.rememberedDefaultProjectLocalId())
                )
            }
        })
    }

    var body: some View {
        List(selection: $actions.selection) {
            row("Inbox", "tray", .inbox, count: live.value.counts.inbox)
            row("Today", "sun.max", .today, count: live.value.counts.today)
            row("Upcoming", "calendar", .upcoming)
            row("Favourites", "star", .favorites)
            row("Search", "magnifyingglass", .search)
            Section("Projects") {
                MacProjectBranch(parent: nil, all: live.value.projects)
            }
            if !live.value.filters.isEmpty {
                Section("Filters") {
                    ForEach(live.value.filters, id: \.serverId) { filter in
                        Label(filter.title, systemImage: "line.3.horizontal.decrease")
                            .tag(MacSelection.savedFilter(filter.serverId))
                    }
                }
            }
        }
        .navigationSplitViewColumnWidth(min: 190, ideal: 230)
        .task { await live.run() }
        .safeAreaInset(edge: .bottom) {
            SettingsLink { Label("Settings", systemImage: "gearshape") }
                .buttonStyle(.link).padding(8)
        }
    }

    private func row(_ title: String, _ symbol: String, _ destination: MacSelection, count: Int = 0) -> some View {
        HStack {
            Label(title, systemImage: symbol)
            Spacer()
            if preferences.custom.showTaskCount, count > 0 {
                Text("\(count)").font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .tag(destination)
    }
}

/// One level of the project tree; parents with sub-projects expand with a disclosure triangle.
struct MacProjectBranch: View {
    let parent: String?
    let all: [ProjectRecord]

    var body: some View {
        ForEach(ProjectTree.children(of: parent, in: all), id: \.localId) { project in
            if ProjectTree.children(of: project.localId, in: all).isEmpty {
                label(project)
            } else {
                DisclosureGroup {
                    MacProjectBranch(parent: project.localId, all: all)
                } label: {
                    label(project)
                }
            }
        }
    }

    private func label(_ project: ProjectRecord) -> some View {
        Label {
            Text(project.title)
        } icon: {
            Image(systemName: "circle.fill")
                .font(.system(size: 9))
                .foregroundStyle(Color(hexString: project.hexColor) ?? .secondary)
        }
        .tag(MacSelection.project(project.localId))
    }
}
