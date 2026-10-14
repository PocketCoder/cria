import CriaKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import UserNotifications

private let presets: [(title: String, period: Int)] = [
    ("At due time", 0), ("5 minutes before", -300), ("1 hour before", -3600)
]

/// The due date, its repeat and the reminders, together. Reminders ride the task update, so each change is queued
/// like any edit. TaskDetailView observes the reminders, shows failures and presents the date sheet, so none of
/// them hangs off a lazily created row. The pickers for a custom reminder show only after "Custom…" in the Add menu.
struct ReminderSection: View {
    @Environment(\.dateDisplay) private var dateDisplay
    @Environment(\.preferences) private var preferences
    @Environment(\.scenePhase) private var scenePhase
    let services: AppServices
    let task: TaskRecord
    let reminders: [ReminderRecord]
    let state: TaskDetailPresentation
    let onEditDue: () -> Void
    let applyRepeat: (TaskPatch) -> Void
    let onCustomRepeat: () -> Void
    @State private var custom: Date?
    @State private var systemDenied = false

    var body: some View {
        Section("Due & reminders") {
            DateValueRow(title: "Due", systemImage: "calendar", iso: task.dueDate, action: onEditDue)
                .task(id: scenePhase) {
                    // Read again on coming back from iOS Settings, so the warning clears once notifications are allowed.
                    systemDenied = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .denied
                }
            if task.dueDate != nil && !task.done { postponeMenu }
            if task.dueDate != nil || task.repeatAfter > 0 || task.repeatMode != 0 {
                RepeatRow(task: task, apply: applyRepeat, onCustom: onCustomRepeat)
            }
            // Position as identity: two reminders can read the same ("1 day before due date" twice).
            ForEach(Array(reminders.enumerated()), id: \.offset) { _, reminder in
                ReminderRow(services: services, taskLocalId: task.localId, reminder: reminder, state: state)
            }
            if !reminders.isEmpty && (systemDenied || !preferences.notificationsEnabled) { notificationWarning }
            if let custom {
                customRows(custom)
            } else {
                addMenu
            }
        }
    }

    /// Reminders are stored on the server either way, but this phone only alerts when the OS and Cria's switch allow it.
    private var notificationWarning: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color(.warning)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(systemDenied
                     ? "Notifications are off for Cria on this iPhone, so reminders will not alert you."
                     : "Notifications are switched off in Cria, so reminders will not alert you.")
                    .font(Theme.caption)
                Button("Open notification settings") {
                    ExternalLink.openNotificationSettings()
                }
                .font(Theme.chip)
            }
        }
        // Borderless, or a tap anywhere in the row would run the button.
        .buttonStyle(.borderless)
    }

    /// Moves the due date on by a preset. Interval presets count from the later of the due date and today; a due
    /// time is kept. The reminders stay as they are.
    private var postponeMenu: some View {
        Menu {
            ForEach(DeferPreset.allCases, id: \.self) { preset in
                Button { postpone(preset) } label: {
                    Text(preset.title)
                    Text(DueDates.label(preset.dueDate(from: task.dueDate), now: Date(), display: dateDisplay))
                }
            }
        } label: {
            Label("Postpone", systemImage: "arrow.uturn.forward").foregroundStyle(Color(.primary))
        }
    }

    private func postpone(_ preset: DeferPreset) {
        var patch = TaskPatch()
        patch.dueDate = preset.dueDate(from: task.dueDate)
        state.attempt { _ = try services.store.updateTask(localId: task.localId, patch: patch) }
    }

    private var addMenu: some View {
        Menu {
            if let due = task.dueDate {
                Section {
                    presetButtons
                } header: {
                    if !DueDates.hasTimeOfDay(due) { Text("The due date has no time, so these count from midnight") }
                }
            }
            Button("In one hour") { add(ReminderInput(triggerAt: DueDates.timedISO(Date().addingTimeInterval(3600)))) }
            Button("Custom…", systemImage: "clock") { custom = defaultCustomDate }
            Button("Relative to a date…", systemImage: "calendar.badge.clock") { state.addingRelativeReminder = true }
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

    @ViewBuilder private var presetButtons: some View {
        ForEach(presets, id: \.period) { preset in
            Button { add(ReminderInput(period: preset.period, relativeTo: .dueDate)) } label: {
                Text(preset.title)
                if let when = presetTime(preset.period) { Text(when) }
            }
        }
        // The day before at the time set in Settings > Customise > Dates & tasks, not 24 hours before.
        if let dayBefore = QuickAddReminder.daysBeforeDue(days: 1, minute: nil).input(dueDate: task.dueDate),
           let period = dayBefore.period {
            Button { add(dayBefore) } label: {
                Text("Day before")
                if let when = presetTime(period) { Text(when) }
            }
        }
    }

    /// When a preset would fire: the due date (its time, or the start of an all-day due day) moved by the period.
    private func presetTime(_ period: Int) -> String? {
        guard let iso = task.dueDate, let due = DueDates.pickerDate(iso) else { return nil }
        return DueDates.fullLabel(due.addingTimeInterval(TimeInterval(period)), display: dateDisplay)
    }

    private func add(_ input: ReminderInput) {
        state.attempt { try services.store.addReminder(taskLocalId: task.localId, input) }
    }
}

extension ReminderRecord {
    /// The moment a relative reminder fires; nil for a fixed-time one, whose summary already says it.
    func firesAtText(display: DateDisplay) -> String? {
        guard relativePeriod != nil, relativeTo != nil, let reminderAt, let date = DueDates.parse(reminderAt) else { return nil }
        return DueDates.fullLabel(date, display: display)
    }

    func summary(display: DateDisplay) -> String {
        if let period = relativePeriod, let anchor = relativeTo {
            if let reminderAt, let fires = DueDates.parse(reminderAt),
               let dayBased = ReminderText.dayBased(period: period, anchor: anchor, fires: fires, display: display) {
                return dayBased
            }
            return ReminderText.relative(period: period, anchor: anchor)
        }
        guard let reminderAt, let date = DueDates.parse(reminderAt) else { return "Pending" }
        return DueDates.fullLabel(date, display: display)
    }
}
