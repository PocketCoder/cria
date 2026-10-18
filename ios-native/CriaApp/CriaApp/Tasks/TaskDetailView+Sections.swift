import CriaKit
import SwiftUI

// The task screen's sections and date sheet, kept apart from TaskDetailView.swift (SwiftLint's file length).
extension TaskDetailView {
    @ViewBuilder
    func section(_ kind: TaskDetailSection, task: TaskRecord) -> some View {
        switch kind {
        case .details:
            TaskPropertiesSection(
                task: task, projects: moveChoices,
                hasSubtasks: feeds.relations.value.contains { $0.kind == "subtask" },
                apply: apply
            ) {
                sheets.attempt { try services.store.followSubtaskProgress(taskLocalId: taskLocalId) }
            }
        case .when:
            ReminderSection(
                services: services, task: task, reminders: feeds.reminders.value, state: sheets,
                onEditDue: { editingDate = .due }, applyRepeat: { apply($0) }, onCustomRepeat: { editingRepeat = true }
            )
        case .schedule:
            TaskScheduleSection(task: task) { editingDate = $0 }
        case .subtasks:
            RelationsSection(services: services, taskLocalId: taskLocalId, relations: feeds.relations.value, state: sheets)
        case .labels:
            labelsSection
        case .assignees:
            AssigneesSection(services: services, taskLocalId: taskLocalId, assignees: feeds.assignees.value, state: sheets)
        case .attachments:
            AttachmentsSection(
                services: services, taskLocalId: taskLocalId, attachments: feeds.attachments.value, state: sheets
            )
        case .comments:
            CommentsSection(services: services, task: task, comments: feeds.comments.value, state: sheets)
        }
    }

    /// The labels, with Edit. On the Mac they sit in the inspector's field box instead.
    @ViewBuilder private var labelsSection: some View {
        #if !os(macOS)
        Section {
            FlowLabels(labels: live.value.labels)
        } header: {
            HStack {
                Text("Labels")
                Spacer()
                Button("Edit") { showLabels = true }.textCase(nil)
                    .accessibilityLabel("Edit labels")
            }
        }
        #endif
    }

    /// The date sheet for one field. The due date carries the repeat too, saved in the same patch.
    func dateSheet(_ field: TaskDateField, task: TaskRecord) -> some View {
        let current: String? = switch field {
        case .due: task.dueDate
        case .start: task.startDate
        case .end: task.endDate
        }
        let repeatValue = field == .due ? RepeatValue(after: task.repeatAfter, mode: task.repeatMode) : nil
        return DateSheet(title: field.title, iso: current, repeatValue: repeatValue) { iso, chosenRepeat in
            var patch = TaskPatch()
            switch field {
            case .due: patch.dueDate = iso
            case .start: patch.startDate = iso
            case .end: patch.endDate = iso
            }
            if let chosenRepeat, chosenRepeat != repeatValue {
                patch.repeatAfter = chosenRepeat.after
                patch.repeatMode = chosenRepeat.mode
            }
            apply(patch)
        }
    }
}
