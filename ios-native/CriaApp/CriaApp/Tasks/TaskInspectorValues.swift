#if os(macOS)
import CriaKit
import SwiftUI
import UserNotifications

/// The field box's Reminders value: a chip per reminder ("On time · 17:30"), each a menu to edit or delete it, then an
/// Add link with the presets, a time of day and a reminder relative to a date. A warning shows when the Mac will not
/// alert. Every change rides the task update, as on iOS.
struct InspectorRemindersValue: View {
    let services: AppServices
    let task: TaskRecord
    let reminders: [ReminderRecord]
    let state: TaskDetailPresentation
    @Environment(\.dateDisplay) private var dateDisplay
    @Environment(\.preferences) private var preferences
    @State private var editTarget: EditTarget?
    @State private var choosingTime = false
    @State private var customDate = Date()
    @State private var systemDenied = false

    private struct EditTarget: Identifiable {
        let id = UUID()
        let reminder: ReminderRecord
    }

    var body: some View {
        HStack(spacing: 6) {
            // Position as identity: two reminders can read the same.
            ForEach(Array(reminders.prefix(2).enumerated()), id: \.offset) { _, reminder in
                Menu { actions(reminder) } label: {
                    CriaChip(text: chipText(reminder), systemImage: "bell", tint: Color(.primary))
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
            }
            if reminders.count > 2 { moreMenu }
            addMenu
            if !reminders.isEmpty && (systemDenied || !preferences.notificationsEnabled) { warning }
        }
        .lineLimit(1)
        .task { await readSystemDenied() }
        .sheet(item: $editTarget) { target in
            if target.reminder.relativeTo != nil {
                RelativeReminderSheet(services: services, taskLocalId: task.localId, editing: target.reminder)
            } else {
                FixedReminderSheet(services: services, taskLocalId: task.localId, old: target.reminder)
            }
        }
        .popover(isPresented: $choosingTime, arrowEdge: .bottom) { timePopover }
    }

    @ViewBuilder
    private func actions(_ reminder: ReminderRecord) -> some View {
        Button("Edit…") { editTarget = EditTarget(reminder: reminder) }
        Button("Delete", role: .destructive) {
            state.attempt { try services.store.removeReminder(taskLocalId: task.localId, reminder) }
        }
    }

    /// "+2": the reminders past the first two, each with the same Edit and Delete.
    private var moreMenu: some View {
        Menu {
            ForEach(Array(reminders.dropFirst(2).enumerated()), id: \.offset) { _, reminder in
                Menu(chipText(reminder)) { actions(reminder) }
            }
        } label: {
            Text("+\(reminders.count - 2)").font(.system(size: 12)).foregroundStyle(MacTheme.label2)
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel("More reminders")
    }

    private var addMenu: some View {
        Menu {
            if task.dueDate != nil {
                ForEach(reminderPresets, id: \.period) { preset in
                    Button(preset.title) { add(ReminderInput(period: preset.period, relativeTo: .dueDate)) }
                }
                // The day before at the time set in Settings, not 24 hours before (as the iOS section does).
                if let dayBefore = QuickAddReminder.daysBeforeDue(days: 1, minute: nil).input(dueDate: task.dueDate) {
                    Button("Day before") { add(dayBefore) }
                }
                Divider()
            }
            Button("In one hour") { add(ReminderInput(triggerAt: DueDates.timedISO(Date().addingTimeInterval(3600)))) }
            Button("At a time…") {
                customDate = defaultCustomDate
                choosingTime = true
            }
            Button("Relative to a date…") { state.addingRelativeReminder = true }
        } label: {
            Text("Add").font(.system(size: 13)).foregroundStyle(Color(.primary))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel("Add reminder")
    }

    private var timePopover: some View {
        VStack(alignment: .leading, spacing: 12) {
            DatePicker("Remind at", selection: $customDate)
            HStack {
                if customDate <= Date() {
                    Text("Pick a future time").font(.system(size: 11)).foregroundStyle(MacTheme.label2)
                }
                Spacer()
                Button("Cancel") { choosingTime = false }
                Button("Add") {
                    add(ReminderInput(triggerAt: DueDates.timedISO(customDate)))
                    choosingTime = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(customDate <= Date())
            }
        }
        .padding(14)
        .frame(width: 300)
    }

    private var warning: some View {
        Button {
            ExternalLink.openNotificationSettings()
        } label: {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color(.warning))
        }
        .buttonStyle(.plain)
        .help(systemDenied
              ? "Notifications are off for Cria on this Mac, so reminders will not alert you."
              : "Notifications are switched off in Cria, so reminders will not alert you.")
        .accessibilityLabel("Reminders will not alert you. Open notification settings")
    }

    private func readSystemDenied() async {
        systemDenied = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .denied
    }

    /// An hour before the due date when that is still ahead, else the next whole hour.
    private var defaultCustomDate: Date {
        let now = Date()
        if let iso = task.dueDate, let due = DueDates.pickerDate(iso) {
            let before = due.addingTimeInterval(-3600)
            if before > now { return before }
        }
        return Calendar.cria.dateInterval(of: .hour, for: now)?.end ?? now.addingTimeInterval(3600)
    }

    private func add(_ input: ReminderInput) {
        state.attempt { try services.store.addReminder(taskLocalId: task.localId, input) }
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
