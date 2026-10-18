import CriaKit
import SwiftUI

extension Notification.Name {
    /// View > Show Project Info (⌥⌘I): toggles the rail on the project on screen.
    static let criaProjectInfoCommand = Notification.Name("io.cria.projectInfoCommand")
}

private struct MacSidebarActionsKey: EnvironmentKey {
    static var defaultValue: MacSidebarActions? { nil }
}

extension EnvironmentValues {
    /// The window's project sheets (share, info, edit, delete), so a project header can open them.
    var macSidebarActions: MacSidebarActions? {
        get { self[MacSidebarActionsKey.self] }
        set { self[MacSidebarActionsKey.self] = newValue }
    }
}

/// The project screen's Mac pieces: the toolbar view picker's icons and the per-project rail setting.
enum MacProjectChrome {
    static func icon(_ kind: ViewKind) -> String {
        switch kind {
        case .list: return "list.bullet"
        case .kanban: return "rectangle.split.3x1"
        case .table: return "tablecells"
        case .gantt: return "chart.bar.xaxis"
        }
    }

    /// The `@AppStorage` key for a project's info rail. On by default.
    static func infoKey(_ projectLocalId: String) -> String { "projectInfo.\(projectLocalId)" }
}

/// The toolbar's view picker: 26pt segments with icon and label in SF 12 Medium, the selected one Semibold in
/// `primary` on a 13% `primary` fill. Drawn by hand because a segmented `Picker` takes none of that styling.
struct MacViewPicker: View {
    let views: [ViewRecord]
    let selectedId: String?
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 2) {
            ForEach(views, id: \.localId) { view in
                let selected = view.localId == selectedId
                Button {
                    onSelect(view.localId)
                } label: {
                    Label(ViewManagement.label(view.slot), systemImage: MacProjectChrome.icon(view.viewKind))
                        .labelStyle(.titleAndIcon)
                        .font(.system(size: 12, weight: selected ? .semibold : .medium))
                        .foregroundStyle(selected ? Color(.primary) : MacTheme.label2)
                        .padding(.horizontal, 10)
                        .frame(height: 26)
                        .background(selected ? Color(.primary).opacity(0.13) : Color.clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(.horizontal, 3)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Project view")
        .help("Project view")
    }
}

/// The in-content header on the Mac: colour dot and Onest title, the subtitle, then Share, the info toggle (List view
/// only) and the project menu, on the title's baseline.
struct MacProjectHeader: View {
    let title: String
    let colour: Color?
    let subtitle: String
    let project: ProjectRecord?
    let projectLocalId: String
    let services: AppServices?
    let showsInfoToggle: Bool
    let canManage: Bool
    let onManage: () -> Void
    @Environment(\.macSidebarActions) private var sheets
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false
    @State private var choosingBackground = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 10) {
                    if let colour {
                        Circle().fill(colour).frame(width: 14, height: 14).accessibilityHidden(true)
                    }
                    Text(title)
                        .font(MacTheme.largeTitle.weight(.bold))
                        .tracking(MacTheme.largeTitleTracking)
                        .foregroundStyle(Color(.foreground))
                        .lineLimit(1)
                        .accessibilityAddTraits(.isHeader)
                }
                Text(subtitle).font(.system(size: 13)).foregroundStyle(MacTheme.label2)
            }
            Spacer(minLength: 12)
            if let project, let sheets, !isLinkShare {
                Button {
                    sheets.sharing = ProjectShareTarget(project: project)
                } label: {
                    Label("Share", systemImage: "person.badge.plus")
                }
                .buttonStyle(.bordered)
            }
            if showsInfoToggle {
                MacProjectInfoToggle(projectLocalId: projectLocalId)
            }
            if let project, let sheets, let services {
                Menu {
                    MacProjectHeaderMenu(
                        project: project, services: services, sheets: sheets, canManage: canManage,
                        onManage: onManage, onBackground: { choosingBackground = true }
                    )
                } label: {
                    Image(systemName: "ellipsis")
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .accessibilityLabel("Project options")
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 18)
        .sheet(isPresented: $choosingBackground) {
            if let project, let services {
                NavigationStack {
                    ProjectBackgroundView(services: services, project: project)
                        .navigationTitle("Background")
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) { Button("Done") { choosingBackground = false } }
                        }
                }
                .frame(minWidth: 420, minHeight: 420)
            }
        }
    }
}

/// The header's ⋯ menu, in the design's order: Edit project…, Manage views…, Add to favourites, Background…, then
/// Duplicate, Archive and Delete project… in red. The actions are the sidebar's (`MacSidebarActions`).
private struct MacProjectHeaderMenu: View {
    let project: ProjectRecord
    let services: AppServices
    let sheets: MacSidebarActions
    let canManage: Bool
    let onManage: () -> Void
    let onBackground: () -> Void
    /// A share link has no account: no duplicating, which the server would refuse.
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false

    var body: some View {
        Button("Edit project…", systemImage: "pencil") { sheets.projectEditor = .edit(project) }
        Button("Manage views…", systemImage: "square.grid.2x2") { onManage() }.disabled(!canManage)
        Toggle(isOn: Binding(get: { project.isFavorite }, set: { _ in sheets.toggleFavourite(project, services: services) })) {
            Label("Add to favourites", systemImage: "star")
        }
        // The background is set on the server at once, so it needs the project synced.
        Button("Background…", systemImage: "photo") { onBackground() }.disabled(project.serverId == nil)
        Divider()
        if !isLinkShare {
            Button("Duplicate", systemImage: "plus.square.on.square") { Task { await sheets.duplicate(project, services: services) } }
        }
        Button("Archive", systemImage: "archivebox") { archive() }
        Button("Delete project…", systemImage: "trash", role: .destructive) { sheets.pendingProjectDelete = project }
    }

    private func archive() {
        do {
            _ = try services.store.updateProject(localId: project.localId, patch: ProjectPatch(isArchived: true))
        } catch {
            sheets.failureTitle = "Could not archive"
            sheets.failure = String(describing: error)
        }
    }
}

/// ⓘ in the header: shows or hides the project info rail, accent coloured while it is on.
private struct MacProjectInfoToggle: View {
    @AppStorage private var showInfo: Bool

    init(projectLocalId: String) {
        _showInfo = AppStorage(wrappedValue: true, MacProjectChrome.infoKey(projectLocalId))
    }

    var body: some View {
        Button {
            showInfo.toggle()
        } label: {
            Image(systemName: showInfo ? "info.circle.fill" : "info.circle")
                .foregroundStyle(showInfo ? Color(.primary) : MacTheme.label2)
        }
        .buttonStyle(.borderless)
        .help(showInfo ? "Hide Project Info ⌥⌘I" : "Show Project Info ⌥⌘I")
        .accessibilityLabel(showInfo ? "Hide project info" : "Show project info")
    }
}
