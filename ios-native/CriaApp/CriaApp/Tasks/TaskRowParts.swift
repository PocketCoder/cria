import CriaKit
import Observation
import SwiftUI

/// The Mac row's hover and open-task highlight. A modifier with its own state, so hovering a row or opening a task
/// redraws this background, not the row it sits behind.
struct PanelRowHighlight: ViewModifier {
    let taskLocalId: String
    @Environment(\.openTaskState) private var openTask
    @State private var hovering = false

    func body(content: Content) -> some View {
        #if os(macOS)
        // The macOS design's row: radius 10 (the row pads itself 8 by 12), selection tint and hover fill.
        content
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(fill))
            .onHover { hovering = $0 }
        #else
        content
            .padding(.horizontal, 6)
            .background(RoundedRectangle(cornerRadius: 6).fill(fill))
            .onHover { hovering = $0 }
        #endif
    }

    private var fill: Color {
        #if os(macOS)
        if openTask?.id == taskLocalId { return MacTheme.selection }
        return hovering || openTask?.focusedId == taskLocalId ? MacTheme.fill : .clear
        #else
        // The web row's open and hover washes: primary at 10%, foreground at 5%. The j/k focus reads as a hover.
        if openTask?.id == taskLocalId { return Color(.primary).opacity(0.10) }
        return hovering || openTask?.focusedId == taskLocalId ? Color(.foreground).opacity(0.05) : .clear
        #endif
    }
}

#if os(macOS)
/// Every label and the visible projects, for the task menu's submenus. One per window, kept current by the shell
/// off the main thread, so building a row's menu reads nothing from the database.
@MainActor @Observable
final class TaskMenuChoices {
    var labels: [LabelRecord] = []
    var projects: [ProjectRecord] = []

    /// Follows the store until the calling task is cancelled.
    func follow(_ store: CriaStore) async {
        let stream = observeStore(store, kinds: [.labels, .projects]) { reading in
            (try reading.labels(), ProjectTree.visible(try reading.projects()))
        }
        for await (labels, projects) in stream {
            if labels != self.labels { self.labels = labels }
            if projects != self.projects { self.projects = projects }
        }
    }
}

/// The task menu's label submenu: every label, ticked when the task has it.
struct TaskRowLabelChoices: View {
    let services: AppServices
    let item: TaskListItem
    let onFailure: (String) -> Void
    @Environment(TaskMenuChoices.self) private var choices: TaskMenuChoices?

    var body: some View {
        ForEach(choices?.labels ?? [], id: \.localId) { label in
            let has = item.labels.contains { $0.localId == label.localId }
            Toggle(label.title, isOn: Binding(get: { has }, set: { _ in toggle(label) }))
        }
    }

    private func toggle(_ label: LabelRecord) {
        do {
            try services.store.toggleTaskLabel(taskLocalId: item.task.localId, labelLocalId: label.localId)
        } catch {
            onFailure(String(describing: error))
        }
    }
}

/// The task menu's Move to submenu: the visible projects, the current one ticked.
struct TaskRowProjectChoices: View {
    let services: AppServices
    let task: TaskRecord
    let onFailure: (String) -> Void
    @Environment(TaskMenuChoices.self) private var choices: TaskMenuChoices?

    var body: some View {
        ForEach(choices?.projects ?? [], id: \.localId) { project in
            Toggle(project.title, isOn: Binding(get: { project.localId == task.projectLocalId }, set: { isOn in
                if isOn { move(to: project.localId) }
            }))
        }
    }

    private func move(to projectLocalId: String) {
        guard projectLocalId != task.projectLocalId else { return }
        var patch = TaskPatch()
        patch.projectLocalId = projectLocalId
        do {
            _ = try services.store.updateTask(localId: task.localId, patch: patch)
        } catch {
            onFailure(String(describing: error))
        }
    }
}
#endif
