import CriaKit
import SwiftUI

/// The Repeat row of task details: `repeat` icon, current value, menu. `apply` saves the patch and reports failures.
/// "Custom…" calls `onCustom`, which opens `RepeatEditorSheet` from the screen (not from this lazily created row).
struct RepeatRow: View {
    let task: TaskRecord
    let apply: (TaskPatch) -> Void
    let onCustom: () -> Void

    var body: some View {
        let current = RepeatChoice(repeatAfter: task.repeatAfter, repeatMode: task.repeatMode)
        Picker(selection: Binding<RepeatChoice>(get: { current }, set: { choose($0) })) {
            ForEach(RepeatChoice.presets) { choice in
                Text(choice.title).tag(choice)
            }
            if current == .custom {
                Text(RepeatLabel.label(repeatAfter: task.repeatAfter, repeatMode: task.repeatMode)).tag(RepeatChoice.custom)
            }
            Text("Custom…").tag(RepeatChoice.edit)
        } label: {
            Label("Repeat", systemImage: "repeat")
        }
    }

    private func choose(_ choice: RepeatChoice) {
        switch choice {
        case .edit:
            onCustom()
        case .custom:
            return
        default:
            var patch = TaskPatch()
            patch.repeatAfter = choice.repeatAfter
            patch.repeatMode = choice.repeatMode
            apply(patch)
        }
    }
}

/// The repeat options the picker offers. Any other interval shows as `custom` (its own label); `edit` opens the
/// custom editor.
enum RepeatChoice: String, Identifiable {
    case never, daily, weekly, monthly, yearly, custom, edit

    static let presets: [RepeatChoice] = [.never, .daily, .weekly, .monthly, .yearly]

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

/// Interval units of the custom editor. A month is 30 days, as in Vikunja-web; "Monthly" (same date) is mode 1.
enum RepeatUnit: Int, CaseIterable, Identifiable {
    case hours = 3600, days = 86_400, weeks = 604_800, months = 2_592_000

    var id: Int { rawValue }

    func title(count: Int) -> String {
        let name = switch self {
        case .hours: "hour"
        case .days: "day"
        case .weeks: "week"
        case .months: "month"
        }
        return count == 1 ? name : "\(name)s"
    }

    /// The editor's starting values for a task's current recurrence. Not repeating starts at every 1 day.
    static func split(repeatAfter: Int, repeatMode: Int) -> (count: Int, unit: RepeatUnit) {
        if repeatMode == 1 { return (1, .months) }
        guard repeatAfter > 0 else { return (1, .days) }
        for unit in [RepeatUnit.months, .weeks, .days] where repeatAfter % unit.rawValue == 0 {
            return (repeatAfter / unit.rawValue, unit)
        }
        return (max(1, Int((Double(repeatAfter) / 3600).rounded(.up))), .hours)
    }
}

/// Every N hours, days, weeks or months, counted from the due date (mode 0) or from completion (mode 2).
struct RepeatEditorSheet: View {
    let onSave: (_ repeatAfter: Int, _ repeatMode: Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var count: Int
    @State private var unit: RepeatUnit
    @State private var fromCompletion: Bool

    init(repeatAfter: Int, repeatMode: Int, onSave: @escaping (_ repeatAfter: Int, _ repeatMode: Int) -> Void) {
        let start = RepeatUnit.split(repeatAfter: repeatAfter, repeatMode: repeatMode)
        _count = State(initialValue: start.count)
        _unit = State(initialValue: start.unit)
        _fromCompletion = State(initialValue: repeatMode == 2)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Stepper(value: $count, in: 1...999) {
                        Text("Every \(count) \(unit.title(count: count))")
                    }
                    Picker("Unit", selection: $unit) {
                        ForEach(RepeatUnit.allCases) { Text($0.title(count: count).capitalized).tag($0) }
                    }
                } footer: {
                    Text("A month here is 30 days. For the same date every month, choose Monthly.")
                }
                Section {
                    Picker("Count from", selection: $fromCompletion) {
                        Text("Due date").tag(false)
                        Text("Completion").tag(true)
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("Next dates count from")
                }
            }
            .criaSurface()
            .navigationTitle("Custom repeat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(count * unit.rawValue, fromCompletion ? 2 : 0)
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
