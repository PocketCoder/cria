import CriaKit
import SwiftUI

/// Close, the more menu and Star for the open task. A toolbar group on iOS; in the Mac panel it sits in
/// `TaskPanelHeader`, because a SwiftUI `.toolbar` there lands in the one window toolbar, which re-tiled on every
/// task switch.
struct TaskDetailHeaderButtons: View {
    let services: AppServices
    let task: TaskRecord?
    let state: TaskDetailPresentation
    let onClose: (() -> Void)?
    let onDuplicate: () -> Void
    let onToggleStar: () -> Void

    var body: some View {
        if let task {
            if let onClose {
                Button("Close", systemImage: "xmark", action: onClose).help("Close (Esc)")
            }
            TaskDetailMenu(services: services, task: task, state: state, onDuplicate: onDuplicate)
            Button(task.isFavorite ? "Unstar" : "Star", systemImage: task.isFavorite ? "star.fill" : "star", action: onToggleStar)
                .tint(task.isFavorite ? Color(.warning) : nil)
        }
    }
}

#if os(macOS)
/// The Mac panel's own title bar: the project name and the task buttons.
struct TaskPanelHeader<Buttons: View>: View {
    let title: String
    @ViewBuilder let buttons: Buttons

    var body: some View {
        HStack(spacing: 6) {
            Text(title).font(.headline).lineLimit(1).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            buttons.labelStyle(.iconOnly).buttonStyle(.borderless)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }
}
#endif
