import CriaKit
import SwiftUI

/// The task title's ring and type: the iOS sizes, or the Mac inspector's (a 20pt ring, SF 18 semibold).
enum TaskInspectorStyle {
    #if os(macOS)
    static let ringSize: CGFloat = 20
    static let titleFont = Font.system(size: 18, weight: .semibold)
    #else
    static let ringSize: CGFloat = 26
    static let titleFont = Theme.title
    #endif
}

#if os(macOS)
extension TaskDetailView {
    /// The inspector's field box. Every value writes through the same paths as the iOS rows: `apply`, the date and
    /// repeat sheets, and the label picker.
    func fieldBox(_ task: TaskRecord) -> some View {
        let store = services.store
        let state = sheets
        return TaskInspectorFieldBox(
            services: services, task: task, labels: live.value.labels, projects: moveChoices,
            reminders: feeds.reminders.value, assignees: feeds.assignees.value,
            apply: { _ = apply($0) },
            onPickDue: { editingDate = .due },
            onCustomRepeat: { editingRepeat = true },
            onEditLabels: { showLabels = true },
            onAddReminder: { input in state.attempt { try store.addReminder(taskLocalId: task.localId, input) } },
            onRelativeReminder: { state.addingRelativeReminder = true },
            onAssign: { state.assigning = true }
        )
    }
}

/// Project, Due, Repeat, Priority, Reminders, Labels and Assignees in one `cell` box with hairlines between rows.
/// Reminders and assignees are edited in full in their own sections below.
struct TaskInspectorFieldBox: View {
    let services: AppServices
    let task: TaskRecord
    let labels: [LabelRecord]
    let projects: [ProjectRecord]
    let reminders: [ReminderRecord]
    let assignees: [AssigneeRecord]
    let apply: (TaskPatch) -> Void
    let onPickDue: () -> Void
    let onCustomRepeat: () -> Void
    let onEditLabels: () -> Void
    let onAddReminder: (ReminderInput) -> Void
    let onRelativeReminder: () -> Void
    let onAssign: () -> Void
    @Environment(\.dateDisplay) private var dateDisplay

    var body: some View {
        VStack(spacing: 0) {
            row("Project", systemImage: "folder") { projectMenu }
            Divider()
            row("Due", systemImage: "calendar") { dueMenu }
            Divider()
            row("Repeat", systemImage: "repeat") { repeatMenu }
            Divider()
            row("Priority", systemImage: "flag") { priorityMenu }
            Divider()
            row("Reminders", systemImage: "bell") {
                InspectorRemindersValue(task: task, reminders: reminders, onAdd: onAddReminder, onRelative: onRelativeReminder)
            }
            Divider()
            row("Labels", systemImage: "tag") {
                InspectorLabelsValue(services: services, taskLocalId: task.localId, labels: labels, onEditLabels: onEditLabels)
            }
            Divider()
            row("Assignees", systemImage: "person.2") { assigneesValue }
        }
        .background(MacTheme.cell, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5))
    }

    private func row<Value: View>(_ title: String, systemImage: String, @ViewBuilder value: () -> Value) -> some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 14))
                .foregroundStyle(MacTheme.label2)
                .frame(width: 18)
                .accessibilityHidden(true)
            Text(title)
                .font(.system(size: 13))
                .foregroundStyle(MacTheme.label2)
                .frame(width: 84, alignment: .leading)
            value()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 36)
    }

    /// A pop-up value: 24pt, radius 7, `fill`, with the up-down chevron.
    private func popUp<Content: View>(_ text: String, tint: Color = .primary, @ViewBuilder content: () -> Content) -> some View {
        Menu {
            content()
        } label: {
            HStack(spacing: 4) {
                Text(text).font(.system(size: 13)).foregroundStyle(tint).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11))
                    .foregroundStyle(MacTheme.label2)
            }
            .padding(.horizontal, 8)
            .frame(height: 24)
            .background(MacTheme.fill, in: RoundedRectangle(cornerRadius: 7))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    private func summary(_ text: String) -> some View {
        Text(text).font(.system(size: 13)).foregroundStyle(MacTheme.label2).lineLimit(1)
    }

    private var projectMenu: some View {
        let current = projects.first { $0.localId == task.projectLocalId }
        return popUp(current?.title ?? "None") {
            ForEach(projects, id: \.localId) { project in
                Toggle(project.title, isOn: Binding(get: { project.localId == task.projectLocalId }, set: { isOn in
                    guard isOn, project.localId != task.projectLocalId else { return }
                    var patch = TaskPatch()
                    patch.projectLocalId = project.localId
                    apply(patch)
                }))
            }
        }
    }

    private var dueMenu: some View {
        let iso = task.dueDate.flatMap { $0.isEmpty ? nil : $0 }
        let text = iso.map { DueDates.label($0, now: Date(), display: dateDisplay) } ?? "None"
        let overdue = iso.map { DueDates.isOverdue($0, now: Date()) && !task.done } ?? false
        return popUp(text, tint: overdue ? MacTheme.coral : .primary) {
            ForEach(QuickAddDatePreset.allCases, id: \.self) { preset in
                Button(preset.title) { apply(TaskPatch(dueDate: preset.iso(now: Date()))) }
            }
            Divider()
            Button("Pick a date…", action: onPickDue)
            // An empty value clears the date, as the date rows do.
            Button("No date") { apply(TaskPatch(dueDate: "")) }.disabled(iso == nil)
        }
    }

    private var repeatMenu: some View {
        let label = RepeatLabel.label(repeatAfter: task.repeatAfter, repeatMode: task.repeatMode)
        return popUp(label.isEmpty ? "Never" : label) {
            ForEach(RepeatChoice.presets) { choice in
                Button(choice.title) {
                    var patch = TaskPatch()
                    patch.repeatAfter = choice.repeatAfter
                    patch.repeatMode = choice.repeatMode
                    apply(patch)
                }
            }
            Divider()
            Button("Custom…", action: onCustomRepeat)
        }
    }

    private var priorityMenu: some View {
        let names = TableCells.priorityNames
        let name = names.indices.contains(task.priority) ? names[task.priority] : "\(task.priority)"
        return popUp(name) {
            ForEach(names.indices.reversed(), id: \.self) { level in
                Toggle(names[level], isOn: Binding(get: { task.priority == level }, set: { isOn in
                    if isOn { apply(TaskPatch(priority: level)) }
                }))
            }
        }
    }

    /// Overlapping 22pt avatars with a 2pt ring, or "None"; either opens the assignee search.
    private var assigneesValue: some View {
        Button(action: onAssign) {
            if assignees.isEmpty {
                summary("None")
            } else {
                HStack(spacing: -6) {
                    ForEach(assignees.prefix(5)) { person in
                        Text(initials(person))
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 22, height: 22)
                            .background(Color(.primary), in: Circle())
                            .overlay(Circle().strokeBorder(MacTheme.cell, lineWidth: 2))
                            .help(person.displayName ?? person.username ?? "")
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(assignees.isEmpty ? "No assignees, add one" : "Assignees, add one")
    }

    private func initials(_ person: AssigneeRecord) -> String {
        let name = person.displayName ?? person.username ?? "?"
        let parts = name.split(separator: " ").prefix(2).compactMap(\.first)
        return parts.isEmpty ? "?" : String(parts).uppercased()
    }
}

/// "Created 2 Oct · Updated today at 09:12 · #103", SF 11 in `label3`.
struct TaskInspectorFooter: View {
    let task: TaskRecord

    var body: some View {
        Text(parts.joined(separator: " · "))
            .font(.system(size: 11))
            .foregroundStyle(MacTheme.label3)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var parts: [String] {
        var parts: [String] = []
        if let created = task.createdAt.flatMap(DueDates.parse) {
            parts.append("Created \(created.formatted(.dateTime.day().month(.abbreviated)))")
        }
        if let updated = DueDates.parse(task.updatedAt) {
            parts.append("Updated \(updated.formatted(date: .abbreviated, time: .shortened))")
        }
        if let identifier = task.identifier, !identifier.isEmpty {
            parts.append(identifier)
        } else if let serverId = task.serverId {
            parts.append("#\(serverId)")
        }
        return parts
    }
}
#endif
