import CriaKit
import SwiftUI

/// The content column's trailing toolbar items after the search field: notifications and New Task as a plain glyph
/// (no filled circle: the toolbar stays quiet, and ⌘N and each list's New Task row also add). No inspector toggle: a
/// task opens by clicking it and closes with its × or a click anywhere else. The project view picker (`ProjectScreen`)
/// and the search field (`.searchable`) are the system's; with the sidebar hidden the system moves its toggle to the
/// leading edge.
struct MacToolbar: ToolbarContent {
    let actions: MacActions
    let services: AppServices

    var body: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) { NotificationBell(services: services) }
        ToolbarItem(placement: .primaryAction) {
            Button { actions.newTask() } label: {
                Image(systemName: "plus")
            }
            .help("New Task ⌘N")
            .accessibilityLabel("New Task")
        }
    }
}
