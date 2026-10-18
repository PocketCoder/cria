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
        #if os(macOS)
        // The inspector's order: star and ••• together, then close.
        if let task {
            Button(task.isFavorite ? "Unstar" : "Star", systemImage: task.isFavorite ? "star.fill" : "star", action: onToggleStar)
                .foregroundStyle(task.isFavorite ? Color(.primary) : MacTheme.label2)
            TaskDetailMenu(services: services, task: task, state: state, onDuplicate: onDuplicate)
                .menuIndicator(.hidden)
                .fixedSize()
            if let onClose {
                Button("Close", systemImage: "xmark", action: onClose).help("Close (Esc)")
                    .foregroundStyle(MacTheme.label2)
            }
        }
        #else
        if let task {
            if let onClose {
                Button("Close", systemImage: "xmark", action: onClose).help("Close (Esc)")
            }
            TaskDetailMenu(services: services, task: task, state: state, onDuplicate: onDuplicate)
            Button(task.isFavorite ? "Unstar" : "Star", systemImage: task.isFavorite ? "star.fill" : "star", action: onToggleStar)
                .tint(task.isFavorite ? Color(.warning) : nil)
        }
        #endif
    }
}

#if os(macOS)
/// The inspector's 52pt top bar: the project breadcrumb (colour dot, then "Parent › Project") and the task buttons.
struct TaskPanelHeader<Buttons: View>: View {
    let project: ProjectRecord?
    /// To name the parent project.
    let projects: [ProjectRecord]
    @ViewBuilder let buttons: Buttons

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color(hexString: project?.hexColor) ?? Color(.mutedForeground))
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
            Text(breadcrumb).font(.system(size: 13)).foregroundStyle(MacTheme.label2).lineLimit(1)
            Spacer(minLength: 8)
            buttons.labelStyle(.iconOnly).buttonStyle(.borderless)
        }
        .padding(.horizontal, 14)
        .frame(height: 52)
        .background(MacTheme.inspector)
    }

    private var breadcrumb: String {
        guard let project else { return "Task" }
        guard let parentId = project.parentLocalId, let parent = projects.first(where: { $0.localId == parentId }) else {
            return project.title
        }
        return "\(parent.title) › \(project.title)"
    }
}
#endif
