import CriaKit
import SwiftUI

private let priorityNames = ["None", "Low", "Medium", "High", "Urgent", "Do now"]

/// Project, priority and progress of a task. `apply` saves a patch and returns false (after reporting it) when the
/// save failed.
struct TaskPropertiesSection: View {
    let task: TaskRecord
    /// Projects the task can move to; includes its current one even when archived.
    let projects: [ProjectRecord]
    /// Progress follows the subtasks unless set by hand.
    let hasSubtasks: Bool
    let apply: (TaskPatch) -> Bool
    let onFollowSubtasks: () -> Void
    /// Bumped when the hand-set flag changes, so the row re-reads it.
    @State private var manualRevision = 0

    var body: some View {
        Section {
            Picker(selection: Binding(get: { task.projectLocalId }, set: { moveTask(to: $0) })) {
                ForEach(projects, id: \.localId) { Text($0.title).tag($0.localId) }
            } label: {
                Label("Project", systemImage: "folder")
            }
            Picker(selection: Binding(get: { task.priority }, set: { _ = apply(TaskPatch(priority: $0)) })) {
                ForEach(priorityNames.indices, id: \.self) { Text(priorityNames[$0]).tag($0) }
            } label: {
                Label { Text("Priority") } icon: {
                    Image(systemName: "flag")
                        .foregroundStyle(ThemeToken.priority(task.priority).map { Color($0) } ?? Color(.mutedForeground))
                }
            }
            PercentDoneRow(stored: task.percentDone, followsSubtasks: followsSubtasks) { value in
                var patch = TaskPatch()
                patch.percentDone = value
                guard apply(patch) else { return false }
                // A value set by hand wins over the subtasks until the user hands it back.
                ProgressOverride.setManual(task.localId, true)
                manualRevision += 1
                return true
            }
            if hasSubtasks && !followsSubtasks {
                Button("Follow subtasks", systemImage: "arrow.triangle.branch") {
                    onFollowSubtasks()
                    manualRevision += 1
                }
                .font(Theme.rowSubtitle)
            }
            TaskColourRow(task: task, apply: apply)
        }
    }

    private var followsSubtasks: Bool {
        _ = manualRevision
        return hasSubtasks && !ProgressOverride.isManual(task.localId)
    }

    private func moveTask(to projectLocalId: String) {
        var patch = TaskPatch()
        patch.projectLocalId = projectLocalId
        _ = apply(patch)
    }
}

/// Which date the date sheet is editing.
enum TaskDateField: String, Identifiable {
    case due, start, end
    var id: String { rawValue }

    var title: String {
        switch self {
        case .due: return "Due date"
        case .start: return "Start date"
        case .end: return "End date"
        }
    }
}

/// Start and end dates, each a one-line row that opens the date sheet.
struct TaskScheduleSection: View {
    let task: TaskRecord
    let onEdit: (TaskDateField) -> Void

    var body: some View {
        Section("Schedule") {
            DateValueRow(title: "Start", systemImage: "calendar.badge.clock", iso: task.startDate) { onEdit(.start) }
            DateValueRow(title: "End", systemImage: "calendar.badge.checkmark", iso: task.endDate) { onEdit(.end) }
        }
    }
}

/// Progress in 10% steps, as in Vikunja-web, on one line. The slider moves a local draft and writes once when the
/// finger lifts; the draft stays on screen until the stored value catches up, so the thumb never jumps back while the
/// write lands.
struct PercentDoneRow: View {
    let stored: Double
    /// Shows that the value comes from the subtasks.
    var followsSubtasks = false
    /// Saves the value; false when the save failed.
    let commit: (Double) -> Bool
    @State private var draft: Double?
    @State private var dragging = false

    var body: some View {
        let shown = draft ?? stored
        HStack(spacing: 12) {
            Label { Text("Done") } icon: {
                Image(systemName: followsSubtasks ? "chart.pie.fill" : "chart.pie")
                    .foregroundStyle(followsSubtasks ? Color(.primary) : Color(.mutedForeground))
            }
            .fixedSize()
            .accessibilityHidden(true)
            Slider(
                value: Binding(get: { shown }, set: { draft = Self.snapped($0) }),
                in: 0...1, step: 0.1,
                onEditingChanged: finishDrag
            )
            .accessibilityLabel(followsSubtasks ? "Done, from subtasks" : "Done")
            .accessibilityValue("\(Int((shown * 100).rounded())) percent")
            Text("\(Int((shown * 100).rounded()))%")
                .font(Theme.rowSubtitle.monospacedDigit())
                .foregroundStyle(Color(.mutedForeground))
                .frame(minWidth: 40, alignment: .trailing)
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
