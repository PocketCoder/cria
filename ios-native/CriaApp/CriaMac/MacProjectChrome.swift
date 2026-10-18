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
