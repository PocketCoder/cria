import CriaKit
import SwiftUI

private let presets: [(title: String, period: Int)] = [
    ("At due time", 0), ("5 minutes before", -300), ("1 hour before", -3600), ("1 day before", -86_400)
]

/// The due date, its repeat and the reminders, together. Reminders ride the task update, so each change is queued
/// like any edit. TaskDetailView observes the reminders, shows failures and presents the date sheet, so none of
/// them hangs off a lazily created row. The pickers for a custom reminder show only after "Custom…" in the Add menu.
struct ReminderSection: View {
    @Environment(\.dateDisplay) private var dateDisplay
    let services: AppServices
    let task: TaskRecord
    let reminders: [ReminderRecord]
    let state: TaskDetailPresentation
    let onEditDue: () -> Void
    let applyRepeat: (TaskPatch) -> Void
    let onCustomRepeat: () -> Void
    @State private var custom: Date?

    var body: some View {
        Section("Due & reminders") {
            DateValueRow(title: "Due", systemImage: "calendar", iso: task.dueDate, action: onEditDue)
            if task.dueDate != nil || task.repeatAfter > 0 || task.repeatMode != 0 {
                RepeatRow(task: task, apply: applyRepeat, onCustom: onCustomRepeat)
            }
            // Position as identity: two reminders can read the same ("1 day before due date" twice).
            ForEach(Array(reminders.enumerated()), id: \.offset) { _, reminder in
                Label { Text(reminder.summary(display: dateDisplay)) } icon: { Image(systemName: "bell").foregroundStyle(Color(.coral500)) }
                    .swipeActions {
                        Button("Delete", role: .destructive) {
                            state.attempt { try services.store.removeReminder(taskLocalId: task.localId, reminder) }
                        }
                    }
            }
            if let custom {
                customRows(custom)
            } else {
                addMenu
            }
        }
    }

    private var addMenu: some View {
        Menu {
            if task.dueDate != nil {
                ForEach(presets, id: \.period) { preset in
                    Button(preset.title) { add(ReminderInput(period: preset.period, relativeTo: .dueDate)) }
                }
            }
            Button("In one hour") { add(ReminderInput(triggerAt: DueDates.timedISO(Date().addingTimeInterval(3600)))) }
            Button("Custom…", systemImage: "clock") { custom = defaultCustomDate }
        } label: {
            Label("Add reminder", systemImage: "bell.badge").foregroundStyle(Color(.primary))
        }
    }

    @ViewBuilder
    private func customRows(_ date: Date) -> some View {
        let isPast = date <= Date()
        DatePicker(selection: Binding(get: { date }, set: { custom = $0 })) {
            Label("Remind at", systemImage: "clock")
        }
        HStack {
            Button("Cancel") { custom = nil }
            Spacer()
            if isPast {
                Text("Pick a future time").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            }
            Button("Add") {
                guard date > Date() else { return }
                add(ReminderInput(triggerAt: DueDates.timedISO(date)))
                custom = nil
            }
            .fontWeight(.semibold)
            .disabled(isPast)
        }
        // Borderless, or a tap anywhere in the row would run both buttons.
        .buttonStyle(.borderless)
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
}

extension ReminderRecord {
    func summary(display: DateDisplay) -> String {
        if let period = relativePeriod, let anchor = relativeTo {
            return ReminderText.relative(period: period, anchor: anchor)
        }
        guard let reminderAt, let date = DueDates.parse(reminderAt) else { return "Pending" }
        return DueDates.fullLabel(date, display: display)
    }
}
