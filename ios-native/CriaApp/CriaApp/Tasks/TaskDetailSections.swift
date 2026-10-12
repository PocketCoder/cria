import CriaKit
import SwiftUI

private let priorityNames = ["None", "Low", "Medium", "High", "Urgent", "Do now"]

/// Project, due date, priority, repeat and progress of a task. `apply` saves a patch and returns false (after
/// reporting it) when the save failed.
struct TaskPropertiesSection: View {
    let task: TaskRecord
    /// Projects the task can move to; includes its current one even when archived.
    let projects: [ProjectRecord]
    let apply: (TaskPatch) -> Bool
    let onCustomRepeat: () -> Void

    var body: some View {
        Section {
            Picker(selection: Binding(get: { task.projectLocalId }, set: { moveTask(to: $0) })) {
                ForEach(projects, id: \.localId) { Text($0.title).tag($0.localId) }
            } label: {
                Label("Project", systemImage: "folder")
            }
            DateFieldRow(title: "Due", iso: task.dueDate) { value in
                _ = apply(TaskPatch(dueDate: value))
            }
            Picker(selection: Binding(get: { task.priority }, set: { _ = apply(TaskPatch(priority: $0)) })) {
                ForEach(priorityNames.indices, id: \.self) { Text(priorityNames[$0]).tag($0) }
            } label: {
                Label { Text("Priority") } icon: {
                    Image(systemName: "flag")
                        .foregroundStyle(ThemeToken.priority(task.priority).map { Color($0) } ?? Color(.mutedForeground))
                }
            }
            RepeatRow(task: task, apply: { _ = apply($0) }, onCustom: onCustomRepeat)
            PercentDoneRow(stored: task.percentDone) { value in
                var patch = TaskPatch()
                patch.percentDone = value
                return apply(patch)
            }
        }
    }

    private func moveTask(to projectLocalId: String) {
        var patch = TaskPatch()
        patch.projectLocalId = projectLocalId
        _ = apply(patch)
    }
}

/// Start and end dates.
struct TaskScheduleSection: View {
    let task: TaskRecord
    let apply: (TaskPatch) -> Bool

    var body: some View {
        Section("Schedule") {
            DateFieldRow(title: "Start", iso: task.startDate) { value in
                var patch = TaskPatch()
                patch.startDate = value
                _ = apply(patch)
            }
            DateFieldRow(title: "End", iso: task.endDate) { value in
                var patch = TaskPatch()
                patch.endDate = value
                _ = apply(patch)
            }
        }
    }
}

/// Progress in 10% steps, as in Vikunja-web. The slider moves a local draft and writes once when the finger lifts;
/// the draft stays on screen until the stored value catches up, so the thumb never jumps back while the write lands.
struct PercentDoneRow: View {
    let stored: Double
    /// Saves the value; false when the save failed.
    let commit: (Double) -> Bool
    @State private var draft: Double?
    @State private var dragging = false

    var body: some View {
        let shown = draft ?? stored
        VStack(alignment: .leading) {
            Text("Done: \(Int((shown * 100).rounded()))%").font(Theme.caption)
            Slider(
                value: Binding(get: { shown }, set: { draft = Self.snapped($0) }),
                in: 0...1, step: 0.1,
                onEditingChanged: finishDrag
            )
            .accessibilityValue("\(Int((shown * 100).rounded())) percent")
        }
        .onChange(of: stored) { _, _ in
            // The write landed (or another change arrived): show the stored value again.
            if !dragging { draft = nil }
        }
    }

    private func finishDrag(_ editing: Bool) {
        dragging = editing
        guard !editing, let value = draft else { return }
        if abs(value - stored) < 0.001 || !commit(value) { draft = nil }
    }

    private static func snapped(_ value: Double) -> Double {
        (min(max(value, 0), 1) * 10).rounded() / 10
    }
}
