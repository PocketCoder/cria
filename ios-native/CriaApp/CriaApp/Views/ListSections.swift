import CriaKit
import SwiftUI

/// List sections: a project's List view grouped by one of its boards' columns, Todoist-style. Vikunja's own List view
/// has none, so they are off until chosen in the project's menu, and the choice follows the account
/// (`Customisation.listSections`).
enum ListSections {
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
struct ListSectionsMenu: View {
    let project: ProjectRecord
    let services: AppServices
    @Environment(\.preferences) private var preferences

    var body: some View {
        let current = preferences.custom.listSectionsBoard(serverId: project.serverId, localId: project.localId)
        // A small read, made when the menu is built: the project's boards change rarely.
        let boards = ((try? services.store.views(forProject: project.localId)) ?? []).filter { $0.viewKind == .kanban }
        Menu("Sections", systemImage: "rectangle.split.3x1") {
            Button {
                ListSections.set(nil, for: project, services: services)
            } label: {
                Label("None", systemImage: current == nil ? "checkmark" : "list.bullet")
            }
            if !boards.isEmpty {
                Divider()
                Section("Columns from") {
                    ForEach(boards, id: \.localId) { board in
                        let key = Customisation.iconKey(serverId: board.serverId, localId: board.localId)
                        Button {
                            ListSections.set(key, for: project, services: services)
                        } label: {
                            Label(board.title, systemImage: current == key ? "checkmark" : "rectangle.split.3x1")
                        }
                    }
                }
            }
        }
    }
}

/// The board sections a list row can move to, set by a project's List view while sections are on.
struct SectionMoves {
    let board: ProjectListBoard
    let move: @MainActor (_ taskLocalId: String, _ column: ProjectListColumn) -> Void
}

/// "Move to Section" in a row's menu: every other column that takes tasks. Nothing outside a sectioned list.
struct SectionMoveMenu: View {
    let taskLocalId: String
    @Environment(\.sectionMoves) private var moves

    var body: some View {
        if let moves {
            let current = moves.board.columnOf[taskLocalId]
            let targets = moves.board.columns.indices.filter { $0 != current && moves.board.columns[$0].acceptsTasks }
                .map { moves.board.columns[$0] }
            if !targets.isEmpty {
                Menu("Move to Section", systemImage: "rectangle.split.3x1") {
                    ForEach(targets, id: \.bucketLocalId) { column in
                        Button(column.title) { moves.move(taskLocalId, column) }
                    }
                }
            }
        }
    }
}

private struct SectionMovesKey: EnvironmentKey {
    static var defaultValue: SectionMoves? { nil }
}

private struct CommentCountsKey: EnvironmentKey {
    static var defaultValue: [Int: Int] { [:] }
}

extension EnvironmentValues {
    var sectionMoves: SectionMoves? {
        get { self[SectionMovesKey.self] }
        set { self[SectionMovesKey.self] = newValue }
    }

    /// Comment counts by task server id for the rows and cards on screen (read from the server, as the Table's
    /// Comments column does); empty where unknown.
    var commentCounts: [Int: Int] {
        get { self[CommentCountsKey.self] }
        set { self[CommentCountsKey.self] = newValue }
    }
}
