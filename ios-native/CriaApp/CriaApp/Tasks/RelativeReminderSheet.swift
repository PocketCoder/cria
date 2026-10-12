import CriaKit
import SwiftUI

/// A reminder at any distance from the task's due, start or end date: an amount, a unit, before or after, and which
/// date it follows. Vikunja keeps it relative, so it moves with the date. Spec: `ReminderList.tsx`.
struct RelativeReminderSheet: View {
    let services: AppServices
    let taskLocalId: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dateDisplay) private var dateDisplay
    private let task: TaskRecord?
    @State private var amount = 1
    @State private var unit = Unit.hours
    @State private var before = true
    @State private var anchor: ReminderAnchor?
    @State private var failure: String?

    init(services: AppServices, taskLocalId: String) {
        self.services = services
        self.taskLocalId = taskLocalId
        task = try? services.store.task(localId: taskLocalId)
    }

    enum Unit: Int, CaseIterable, Identifiable {
        case minutes = 60, hours = 3_600, days = 86_400, weeks = 604_800
        var id: Int { rawValue }

        var title: String {
            switch self {
            case .minutes: return "Minutes"
            case .hours: return "Hours"
            case .days: return "Days"
            case .weeks: return "Weeks"
            }
        }
    }

    /// The dates the task has; a reminder cannot follow one it lacks.
    private var anchors: [ReminderAnchor] {
        guard let task else { return [] }
        return ReminderAnchor.allCases.filter { Self.date(of: $0, in: task) != nil }
    }

    /// The amount kept to a sane size, so a long run of digits cannot overflow the seconds.
    private var count: Int { min(max(amount, 0), 100_000) }

    /// Seconds from the date, negative before it.
    private var period: Int { (before ? -1 : 1) * count * unit.rawValue }

    var body: some View {
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
                            ForEach(Unit.allCases) { Text($0.title).tag($0) }
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
            .navigationTitle("Relative reminder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", action: add).disabled(anchors.isEmpty)
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

    private func add() {
        guard let chosen = anchor ?? anchors.first else { return }
        do {
            try services.store.addReminder(taskLocalId: taskLocalId, ReminderInput(period: period, relativeTo: chosen))
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
