import CriaKit
import SwiftUI

/// A reminder at any distance from the task's due, start or end date: an amount, a unit, before or after, and which
/// date it follows. Vikunja keeps it relative, so it moves with the date. Spec: `ReminderList.tsx`.
/// Given `editing`, the sheet opens on that reminder and Save replaces it instead of adding another.
struct RelativeReminderSheet: View {
    let services: AppServices
    let taskLocalId: String
    /// The reminder being edited, as it was when the sheet opened; nil to add a new one.
    let editing: ReminderRecord?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dateDisplay) private var dateDisplay
    private let task: TaskRecord?
    @State private var amount: Int
    @State private var unit: ReminderUnit
    @State private var before: Bool
    @State private var anchor: ReminderAnchor?
    @State private var failure: String?

    init(services: AppServices, taskLocalId: String, editing: ReminderRecord? = nil) {
        self.services = services
        self.taskLocalId = taskLocalId
        self.editing = editing
        task = try? services.store.task(localId: taskLocalId)
        let fallback = ReminderPeriod(amount: 1, unit: .hours, before: true)
        let period = editing?.relativePeriod.map(ReminderPeriod.init(seconds:)) ?? fallback
        _amount = State(initialValue: period.amount)
        _unit = State(initialValue: period.unit)
        _before = State(initialValue: period.before)
        _anchor = State(initialValue: editing?.relativeTo.flatMap(ReminderAnchor.init(rawValue:)))
    }

    /// The dates the task has; a reminder cannot follow one it lacks. An edited reminder keeps its own date listed,
    /// so the picker never opens on a blank choice.
    private var anchors: [ReminderAnchor] {
        guard let task else { return [] }
        let own = editing?.relativeTo.flatMap(ReminderAnchor.init(rawValue:))
        return ReminderAnchor.allCases.filter { $0 == own || Self.date(of: $0, in: task) != nil }
    }

    /// The amount kept to a sane size, so a long run of digits cannot overflow the seconds.
    /// Seconds from the date, negative before it.
    private var period: Int { ReminderPeriod(amount: amount, unit: unit, before: before).seconds }

    var body: some View { sheetContent.macSheetFrame() }

    @ViewBuilder private var sheetContent: some View {
        NavigationStack {
            Form {
                if anchors.isEmpty {
                    Section {
                        Text("Set a due, start or end date first. A relative reminder counts from one of them.")
                            .foregroundStyle(Color(.mutedForeground))
                    }
                } else {
                    Section {
                        LabeledContent("Amount") {
                            TextField("Amount", value: $amount, format: .number)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                        }
                        Picker("Unit", selection: $unit) {
                            ForEach(ReminderUnit.allCases, id: \.self) { Text($0.title).tag($0) }
                        }
                        Picker("Direction", selection: $before) {
                            Text("Before").tag(true)
                            Text("After").tag(false)
                        }
                        .pickerStyle(.segmented)
                        Picker("Date", selection: Binding(get: { anchor ?? anchors[0] }, set: { anchor = $0 })) {
                            ForEach(anchors, id: \.self) { Text(Self.name(of: $0)).tag($0) }
                        }
                    } footer: {
                        Text(caption)
                    }
                }
                if let failure {
                    Section { Text(failure).foregroundStyle(Color(.destructive)) }
                }
            }
            .criaSurface()
            .navigationTitle(editing == nil ? "Relative reminder" : "Edit reminder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(editing == nil ? "Add" : "Save", action: save).disabled(anchors.isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// "2 hours before the due date: 11 Oct 2026 15:00", or what to fix.
    private var caption: String {
        guard let task, let chosen = anchor ?? anchors.first else { return "" }
        let words = ReminderText.relative(period: period, anchor: chosen.rawValue)
        guard let iso = Self.date(of: chosen, in: task), let date = DueDates.pickerDate(iso) else { return words }
        let fires = DueDates.fullLabel(date.addingTimeInterval(TimeInterval(period)), display: dateDisplay)
        return "\(words.prefix(1).uppercased())\(words.dropFirst()): \(fires)"
    }

    private func save() {
        guard let chosen = anchor ?? anchors.first else { return }
        let input = ReminderInput(period: period, relativeTo: chosen)
        do {
            if let editing {
                try services.store.replaceReminder(taskLocalId: taskLocalId, old: editing, with: input)
            } else {
                try services.store.addReminder(taskLocalId: taskLocalId, input)
            }
            dismiss()
        } catch {
            failure = String(describing: error)
        }
    }

    private static func date(of anchor: ReminderAnchor, in task: TaskRecord) -> String? {
        let value: String? = switch anchor {
        case .dueDate: task.dueDate
        case .startDate: task.startDate
        case .endDate: task.endDate
        }
        return value?.isEmpty == false ? value : nil
    }

    private static func name(of anchor: ReminderAnchor) -> String {
        switch anchor {
        case .dueDate: return "Due date"
        case .startDate: return "Start date"
        case .endDate: return "End date"
        }
    }
}

private extension ReminderUnit {
    var title: String {
        switch self {
        case .minutes: return "Minutes"
        case .hours: return "Hours"
        case .days: return "Days"
        case .weeks: return "Weeks"
        }
    }
}
