#if os(macOS)
import CriaKit
import SwiftUI

/// The field box's Reminders value: a chip per reminder ("On time · 17:30"), then an Add link with the presets.
struct InspectorRemindersValue: View {
    let task: TaskRecord
    let reminders: [ReminderRecord]
    let onAdd: (ReminderInput) -> Void
    let onRelative: () -> Void
    @Environment(\.dateDisplay) private var dateDisplay

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(reminders.prefix(2).enumerated()), id: \.offset) { _, reminder in
                CriaChip(text: chipText(reminder), systemImage: "bell", tint: Color(.primary))
            }
            if reminders.count > 2 {
                Text("+\(reminders.count - 2)").font(.system(size: 12)).foregroundStyle(MacTheme.label2)
            }
            addMenu
        }
        .lineLimit(1)
    }

    private var addMenu: some View {
        Menu {
            if task.dueDate != nil {
                ForEach(reminderPresets, id: \.period) { preset in
                    Button(preset.title) { onAdd(ReminderInput(period: preset.period, relativeTo: .dueDate)) }
                }
                Divider()
            }
            Button("In one hour") { onAdd(ReminderInput(triggerAt: DueDates.timedISO(Date().addingTimeInterval(3600)))) }
            Button("Relative to a date…", action: onRelative)
        } label: {
            Text("Add").font(.system(size: 13)).foregroundStyle(Color(.primary))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel("Add reminder")
    }

    /// "On time · 17:30", "1 hour before · 16:30", or a fixed reminder's date and time.
    private func chipText(_ reminder: ReminderRecord) -> String {
        guard let period = reminder.relativePeriod, reminder.relativeTo != nil else {
            return reminder.summary(display: dateDisplay)
        }
        let when = period == 0 ? "On time" : "\(ReminderText.span(seconds: period)) \(period < 0 ? "before" : "after")"
        guard let fires = reminder.reminderAt.flatMap(DueDates.parse) else { return when }
        return "\(when) · \(DueDates.timeLabel(fires, display: dateDisplay))"
    }
}

/// The field box's Labels value: the task's chips, then a 24pt + that opens a popover with the Popular one-click
/// labels (`TaskLabelsRows`) and the full picker.
struct InspectorLabelsValue: View {
    let services: AppServices
    let taskLocalId: String
    let labels: [LabelRecord]
    let onEditLabels: () -> Void
    @State private var showing = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(labels, id: \.localId) { label in
                CriaChip(text: label.title, tint: Color(hexString: label.hexColor) ?? Color(.info))
            }
            Button { showing = true } label: {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(MacTheme.label2)
                    .frame(width: 24, height: 24)
                    .background(MacTheme.fill, in: RoundedRectangle(cornerRadius: 7))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Add labels")
            .popover(isPresented: $showing, arrowEdge: .bottom) { popover }
        }
        .lineLimit(1)
    }

    private var popover: some View {
        VStack(alignment: .leading, spacing: 12) {
            TaskLabelsRows(services: services, taskLocalId: taskLocalId, labels: labels)
            Divider()
            Button("All labels…") {
                showing = false
                onEditLabels()
            }
            .buttonStyle(.link)
        }
        .padding(14)
        .frame(width: 280, alignment: .leading)
    }
}
#endif
