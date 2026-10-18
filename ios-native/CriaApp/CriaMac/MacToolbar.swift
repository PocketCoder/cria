import SwiftUI

/// The content column's trailing toolbar items after the search field: New Task as a solid purple circle, then the
/// inspector toggle, accent coloured while the inspector is open.
struct MacToolbar: ToolbarContent {
    let actions: MacActions

    var body: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button { actions.newTask() } label: {
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 20, height: 20)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.circle)
            .tint(Color(.primary))
            .help("New Task ⌘N")
            .accessibilityLabel("New Task")
        }
        ToolbarItem(placement: .primaryAction) {
            Button { actions.toggleInspector() } label: {
                Image(systemName: "sidebar.right")
            }
            .foregroundStyle(actions.hasOpenTask ? Color(.primary) : Color.primary)
            // Nothing to show until a list on screen has a task.
            .disabled(!actions.hasOpenTask && actions.panel.focusedId == nil && actions.panel.visibleIds.isEmpty)
            .help(actions.hasOpenTask ? "Hide Inspector" : "Show Inspector")
            .accessibilityLabel(actions.hasOpenTask ? "Hide Inspector" : "Show Inspector")
        }
    }
}
