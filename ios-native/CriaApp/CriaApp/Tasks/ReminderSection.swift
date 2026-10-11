import CriaKit
import SwiftUI

private let presets: [(title: String, period: Int)] = [
    ("At due time", 0), ("5 minutes before", -300), ("1 hour before", -3600), ("1 day before", -86_400)
]

/// Reminders and recurrence for a task. Reminders ride the task update, so each change is queued like any edit.
struct ReminderSection: View {
    let services: AppServices
    let task: TaskRecord
    @State private var live: LiveValue<[ReminderRecord]>
    @State private var custom = Date().addingTimeInterval(3600)

    init(services: AppServices, task: TaskRecord) {
        self.services = services
        self.task = task
        let store = services.store
        let localId = task.localId
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks]) { reading in
                try reading.reminders(forTask: localId)
            }
        })
    }

    var body: some View {
        Section("Reminders") {
            ForEach(live.value, id: \.summary) { reminder in
                Label(reminder.summary, systemImage: "bell")
                    .swipeActions {
                        Button("Delete", role: .destructive) {
                            try? services.store.removeReminder(taskLocalId: task.localId, reminder)
                        }
                    }
            }
            Menu("Add reminder", systemImage: "bell.badge") {
                if task.dueDate != nil {
                    ForEach(presets, id: \.period) { preset in
                        Button(preset.title) { add(ReminderInput(period: preset.period, relativeTo: .dueDate)) }
                    }
                }
                Button("In one hour") { add(ReminderInput(triggerAt: DueDates.timedISO(Date().addingTimeInterval(3600)))) }
            }
            DatePicker("Custom", selection: $custom)
            Button("Add custom reminder") { add(ReminderInput(triggerAt: DueDates.timedISO(custom))) }
            repeatRow
        }
        .task { await live.run() }
    }

    private var repeatRow: some View {
        let label = RepeatLabel.label(repeatAfter: task.repeatAfter, repeatMode: task.repeatMode)
        return Picker("Repeat", selection: Binding(get: { label }, set: setRepeat)) {
            ForEach(Array(Set(["", label, "Daily", "Weekly", "Monthly", "Yearly"])).sorted(), id: \.self) {
                Text($0.isEmpty ? "Never" : $0).tag($0)
            }
        }
    }

    private func setRepeat(_ label: String) {
        var patch = TaskPatch()
        switch label {
        case "Daily": (patch.repeatAfter, patch.repeatMode) = (86_400, 0)
        case "Weekly": (patch.repeatAfter, patch.repeatMode) = (604_800, 0)
        case "Yearly": (patch.repeatAfter, patch.repeatMode) = (31_536_000, 0)
        case "Monthly": (patch.repeatAfter, patch.repeatMode) = (0, 1)
        case "": (patch.repeatAfter, patch.repeatMode) = (0, 0)
        default: return
        }
        _ = try? services.store.updateTask(localId: task.localId, patch: patch)
    }

    private func add(_ input: ReminderInput) {
        try? services.store.addReminder(taskLocalId: task.localId, input)
    }
}

extension ReminderRecord {
    var summary: String {
        if let period = relativePeriod, let anchor = relativeTo {
            let minutes = abs(period) / 60
            let when = period == 0 ? "at" : "\(minutes) min \(period < 0 ? "before" : "after")"
            return "\(when) \(anchor.replacingOccurrences(of: "_", with: " "))"
        }
        guard let reminderAt, let date = DueDates.parse(reminderAt) else { return "Pending" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
