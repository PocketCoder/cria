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
    #if os(macOS)
    /// The ⋯ menu's other items: the task's labels, and done, date, delete as the detail runs them.
    var macMenu: TaskDetailMacMenuActions?
    #endif

    var body: some View {
        #if os(macOS)
        // The inspector's order: star and ⋯ together in one glass group, then close.
        if let task {
            HStack(spacing: 0) {
                Button(task.isFavorite ? "Unstar" : "Star", systemImage: task.isFavorite ? "star.fill" : "star", action: onToggleStar)
                    .foregroundStyle(task.isFavorite ? Color(.primary) : MacTheme.label2)
                    .frame(width: 28, height: 28)
                TaskDetailMenu(services: services, task: task, state: state, onDuplicate: onDuplicate, macMenu: macMenu)
                    .menuIndicator(.hidden)
                    .foregroundStyle(MacTheme.label2)
                    .frame(width: 28, height: 28)
            }
            .padding(.horizontal, 2)
            .modifier(HeaderGlass())
            if let onClose {
                Button("Close", systemImage: "xmark", action: onClose).help("Close (Esc)")
                    .foregroundStyle(MacTheme.label2)
                    .frame(width: 28, height: 28)
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
            Button(action: openProject) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color(hexString: project?.hexColor) ?? Color(.mutedForeground))
                        .frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                    Text(breadcrumb).font(.system(size: 13)).foregroundStyle(MacTheme.label2).lineLimit(1)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(project == nil)
            .help("Show project")
            Spacer(minLength: 8)
            buttons.labelStyle(.iconOnly).buttonStyle(.borderless)
        }
        .padding(.horizontal, 14)
        .frame(height: 52)
        .background(MacTheme.inspector)
    }

    /// The Mac shell handles this (`MacOpenProjectHandler`) and shows the project.
    private func openProject() {
        guard let project else { return }
        NotificationCenter.default.post(name: .criaOpenProject, object: project.localId)
    }

    private var breadcrumb: String {
        guard let project else { return "Task" }
        guard let parentId = project.parentLocalId, let parent = projects.first(where: { $0.localId == parentId }) else {
            return project.title
        }
        return "\(parent.title) › \(project.title)"
    }
}

/// The star and ⋯ group's background: Liquid Glass on macOS 26, a material capsule before it.
private struct HeaderGlass: ViewModifier {
    func body(content: Content) -> some View {
        if #available(macOS 26, *) {
            content.glassEffect(.regular, in: Capsule())
        } else {
            content.background(.regularMaterial, in: Capsule())
        }
    }
}
#endif
