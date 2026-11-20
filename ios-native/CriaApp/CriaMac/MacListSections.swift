import CriaKit
import SwiftUI

/// List sections: a project's List view grouped by one of its boards' columns, Todoist-style. Vikunja's own List view
/// has none, so they are off until chosen in the project's menu, and the choice follows the account
/// (`Customisation.listSections`).
enum MacListSections {
    /// Turns sections on with a board (its `ProjectListBoard.key`), or off with nil. Entries for projects that no longer
    /// exist are dropped on the way, as for project icons.
    @MainActor
    static func set(_ boardKey: String?, for project: ProjectRecord, services: AppServices) {
        let model = PreferencesModel(services: services)
        var custom = model.value.custom
        custom.listSections["local:" + project.localId] = nil
        custom.listSections[Customisation.iconKey(serverId: project.serverId, localId: project.localId)] = boardKey
        let projects = (try? services.store.projects()) ?? []
        let live = Set(projects.flatMap { [Customisation.iconKey(serverId: $0.serverId, localId: $0.localId), "local:" + $0.localId] })
        // Only once the store has projects: an empty read must not wipe the list.
        if !projects.isEmpty { custom.listSections = custom.listSections.filter { live.contains($0.key) } }
        guard custom != model.value.custom else { return }
        model.value.custom = custom
    }
}

/// The Sections submenu in a project's menu: None (Vikunja's plain list), then each of the project's boards.
struct MacListSectionsMenu: View {
    let project: ProjectRecord
    let services: AppServices
    @Environment(\.preferences) private var preferences

    var body: some View {
        let current = preferences.custom.listSectionsBoard(serverId: project.serverId, localId: project.localId)
        // A small read, made when the menu is built: the project's boards change rarely.
        let boards = ((try? services.store.views(forProject: project.localId)) ?? []).filter { $0.viewKind == .kanban }
        Menu("Sections", systemImage: "rectangle.split.3x1") {
            Button {
                MacListSections.set(nil, for: project, services: services)
            } label: {
                Label("None", systemImage: current == nil ? "checkmark" : "list.bullet")
            }
            if !boards.isEmpty {
                Divider()
                Section("Columns from") {
                    ForEach(boards, id: \.localId) { board in
                        let key = Customisation.iconKey(serverId: board.serverId, localId: board.localId)
                        Button {
                            MacListSections.set(key, for: project, services: services)
                        } label: {
                            Label(board.title, systemImage: current == key ? "checkmark" : "rectangle.split.3x1")
                        }
                    }
                }
            }
        }
    }
}

/// A board column's header in the List view: a chevron that folds the section, the column's title and its count.
struct MacListSectionHeader: View {
    let title: String
    let count: Int
    @Binding var folded: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button {
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) { folded.toggle() }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(MacTheme.label3)
                    .rotationEffect(.degrees(folded ? 0 : 90))
                    .frame(width: 12)
                Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Color(.foreground))
                Text("\(count)").font(.system(size: 12)).foregroundStyle(MacTheme.label2).monospacedDigit()
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .macPointer()
        .textCase(nil)
        .accessibilityLabel("\(title), \(count) tasks")
        .accessibilityValue(folded ? "Collapsed" : "Expanded")
        .accessibilityAddTraits(.isHeader)
    }
}
