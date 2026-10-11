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
    @State private var failure: String?

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
            // Position as identity: two reminders can read the same ("1 day before due date" twice).
            ForEach(Array(live.value.enumerated()), id: \.offset) { _, reminder in
                Label(reminder.summary, systemImage: "bell")
                    .swipeActions {
                        Button("Delete", role: .destructive) {
                            do {
                                try services.store.removeReminder(taskLocalId: task.localId, reminder)
                            } catch {
                                failure = String(describing: error)
                            }
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
            // The observer and the alert hang off one row, not the Section: modifiers on a Section inside a Form can
            // be applied once per row.
            repeatRow
                .task { await live.run() }
                .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(failure ?? "")
                }
        }
    }

    private var repeatRow: some View {
        Picker("Repeat", selection: Binding<RepeatChoice>(
            get: { RepeatChoice(repeatAfter: task.repeatAfter, repeatMode: task.repeatMode) },
            set: { choice in setRepeat(choice) }
        )) {
            ForEach(RepeatChoice.allCases) { choice in
                Text(choice.title).tag(choice)
            }
        }
    }

    private func setRepeat(_ choice: RepeatChoice) {
        guard choice != .custom else { return }
        var patch = TaskPatch()
        patch.repeatAfter = choice.repeatAfter
        patch.repeatMode = choice.repeatMode
        _ = try? services.store.updateTask(localId: task.localId, patch: patch)
    }

    private func add(_ input: ReminderInput) {
        do {
            try services.store.addReminder(taskLocalId: task.localId, input)
        } catch {
            failure = String(describing: error)
        }
    }
}

extension ReminderRecord {
    var summary: String {
        if let period = relativePeriod, let anchor = relativeTo {
            return ReminderText.relative(period: period, anchor: anchor)
        }
        guard let reminderAt, let date = DueDates.parse(reminderAt) else { return "Pending" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

/// The repeat options the picker offers. Other intervals set on the server show as "Custom" and are left alone.
enum RepeatChoice: String, CaseIterable, Identifiable {
    case never, daily, weekly, monthly, yearly, custom

    var id: String { rawValue }

    init(repeatAfter: Int, repeatMode: Int) {
        let label = RepeatLabel.label(repeatAfter: repeatAfter, repeatMode: repeatMode)
        switch label {
        case "": self = .never
        case "Daily": self = .daily
        case "Weekly": self = .weekly
        case "Monthly": self = .monthly
        case "Yearly": self = .yearly
        default: self = .custom
        }
    }

    var title: String { self == .never ? "Never" : rawValue.capitalized }

    var repeatAfter: Int {
        switch self {
        case .daily: 86_400
        case .weekly: 604_800
        case .yearly: 31_536_000
        default: 0
        }
    }

    var repeatMode: Int { self == .monthly ? 1 : 0 }
}
