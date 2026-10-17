import CriaKit
import SwiftUI

struct MacSidebarData: Equatable, Sendable {
    /// Visible projects by parent (nil = roots), built once per read rather than twice per project per render.
    var children: [String?: [ProjectRecord]] = [:]
    var filters: [SavedFilterRecord] = []
    var labels: [LabelRecord] = []
    var counts = TabCounts()
}

/// The desktop app's sidebar order: Today, Upcoming, Inbox, Favourites and Search, then saved filters, labels and the
/// project tree. Titles and symbols are the iOS tabs'. Counts show on the right when Settings > Customise > Show task
/// count is on. The system draws the glass on macOS 26; no background.
struct MacSidebar: View {
    let services: AppServices
    let actions: MacActions
    @State private var live: LiveValue<MacSidebarData>
    @Environment(\.preferences) private var preferences
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false

    private var sheets: MacSidebarActions { actions.sidebar }

    init(services: AppServices, actions: MacActions) {
        self.services = services
        self.actions = actions
        let store = services.store
        _live = State(initialValue: LiveValue(initial: MacSidebarData()) {
            observeStore(store, kinds: [.projects, .tasks, .savedFilters, .labels]) { (reading: CriaStore) throws -> MacSidebarData in
                MacSidebarData(
                    children: ProjectTree.childIndex(ProjectTree.visible(try reading.projects())),
                    filters: try reading.savedFilters(),
                    labels: try reading.labels(),
                    counts: try TabCounts.read(reading, inboxLocalId: services.rememberedDefaultProjectLocalId())
                )
            }
        })
    }

    var body: some View {
        List(selection: selection) {
            row(.today, .today, count: live.value.counts.today)
            row(.upcoming, .upcoming)
            row(.inbox, .inbox, count: live.value.counts.inbox)
            row(.favorites, .favorites)
            row(.search, .search)
            // Shown when empty too, so its + is where a first filter is made. A share link has no saved filters.
            if !isLinkShare {
                Section {
                    ForEach(live.value.filters, id: \.serverId) { filter in
                        Label(filter.title, systemImage: "line.3.horizontal.decrease")
                            .tag(MacSelection.savedFilter(filter.serverId))
                            .contextMenu {
                                Button("Edit…", systemImage: "pencil") { sheets.filterEditor = FilterEditorTarget(record: filter) }
                                Button("Delete…", systemImage: "trash", role: .destructive) { sheets.pendingFilterDelete = filter }
                            }
                    }
                } header: {
                    HStack {
                        eyebrow("Filters")
                        Spacer()
                        Button { sheets.newFilter() } label: {
                            Image(systemName: "plus").frame(width: 20, height: 20).contentShape(Rectangle())
                        }
                            .buttonStyle(.plain)
                            .foregroundStyle(Color(.mutedForeground))
                            // Clear of the sidebar's edge, in line with the row counts.
                            .padding(.trailing, 6)
                            .help("New saved filter")
                            .accessibilityLabel("New saved filter")
                    }
                }
            }
            if !live.value.labels.isEmpty {
                Section {
                    ForEach(live.value.labels, id: \.localId) { label in
                        Label {
                            Text(label.title)
                        } icon: {
                            Image(systemName: "tag.fill")
                                .font(.system(size: 10))
                                .foregroundStyle(Color(hexString: label.hexColor) ?? Color(.mutedForeground))
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
                    eyebrow("Labels")
                }
            }
            Section {
                MacProjectBranch(parent: nil, children: live.value.children, services: services, sheets: sheets)
            } header: {
                eyebrow("Projects")
            }
        }
        .navigationSplitViewColumnWidth(min: 190, ideal: 220)
        .task { await live.run() }
        .safeAreaInset(edge: .bottom) {
            SettingsLink { Label("Settings", systemImage: "gearshape") }
                .buttonStyle(.plain)
                .foregroundStyle(Color(.mutedForeground))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
        }
    }

    /// The web sidebar's section heading: small, semibold, upper case, muted.
    private func eyebrow(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 10, weight: .semibold))
            .textCase(.uppercase)
            .tracking(0.25)
            .foregroundStyle(Color(.mutedForeground))
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
                Text("\(count)").font(Theme.caption).foregroundStyle(Color(.mutedForeground)).monospacedDigit()
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
        Label {
            Text(project.title)
        } icon: {
            Image(systemName: "circle.fill")
                .font(.system(size: 9))
                .foregroundStyle(Color(hexString: project.hexColor) ?? Color(.mutedForeground))
        }
        .tag(MacSelection.project(project.localId))
        // On the row itself, not the disclosure group, so a sub-project's menu is its own.
        .contextMenu { MacProjectMenu(project: project, services: services, sheets: sheets) }
    }
}
