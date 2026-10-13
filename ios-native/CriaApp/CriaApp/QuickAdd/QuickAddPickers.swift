import CriaKit
import SwiftUI

/// Fields a picker can set over what the typed line parses to. Once picked, the typed token no longer changes it.
enum QuickAddField: Hashable {
    case due, priority, project
}

/// The sheets quick add opens over itself.
enum QuickAddPickerSheet: String, Identifiable {
    case date, labels, reminder
    var id: String { rawValue }
}

/// The due date chip. Tapping opens the date sheet (type a date, presets, calendar, time).
struct QuickAddDateChip: View {
    let dueISO: String
    /// Off: an empty chip shows only its icon.
    var showsLabel = true
    let onTap: () -> Void
    @Environment(\.dateDisplay) private var dateDisplay

    var body: some View {
        Button(action: onTap) {
            CriaChip(
                text: dueISO.isEmpty ? (showsLabel ? "Date" : "") : DueDates.label(dueISO, now: Date(), display: dateDisplay),
                systemImage: "calendar", tint: Color(.sky700)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Date")
    }
}

/// The reminder chip. The options relative to the due date are greyed out until the task has one.
struct QuickAddReminderMenu: View {
    @Binding var reminders: [QuickAddReminder]
    let hasDueDate: Bool
    /// Off: with no reminder the chip shows only its icon.
    var showsLabel = true
    let onCustom: () -> Void
    @Environment(\.dateDisplay) private var dateDisplay

    private static let presets: [(title: String, seconds: Int)] = [
        ("At due time", 0), ("1 hour before", 3_600), ("1 day before", 86_400)
    ]

    var body: some View {
        Menu {
            Section {
                ForEach(Self.presets, id: \.seconds) { preset in
                    Toggle(preset.title, isOn: binding(for: .beforeDue(seconds: preset.seconds)))
                        .disabled(!hasDueDate)
                }
            } header: {
                if !hasDueDate { Text("Set a date to remind before it") }
            }
            Button("Custom…", systemImage: "clock") { onCustom() }
            if !reminders.isEmpty {
                Button("Remove reminders", systemImage: "bell.slash", role: .destructive) { reminders = [] }
            }
        } label: {
            CriaChip(text: chipText, systemImage: reminders.isEmpty ? "bell" : "bell.fill", tint: Color(.coral500))
        }
        .accessibilityLabel("Reminders")
    }

    private func binding(for reminder: QuickAddReminder) -> Binding<Bool> {
        Binding(
            get: { reminders.contains(reminder) },
            set: { isOn in
                reminders.removeAll { $0 == reminder }
                if isOn { reminders.append(reminder) }
            }
        )
    }

    private var chipText: String {
        guard reminders.count == 1, let only = reminders.first else {
            return reminders.isEmpty ? (showsLabel ? "Remind" : "") : "\(reminders.count) reminders"
        }
        switch only {
        case .beforeDue(let seconds):
            return seconds == 0 ? "At due time" : "\(ReminderText.span(seconds: seconds)) before"
        case .atTime(let iso):
            guard let date = DueDates.parse(iso) else { return "Remind" }
            return DueDates.fullLabel(date, display: dateDisplay)
        }
    }
}

/// A date (graphical calendar) with an optional time, for the due date and custom reminders.
struct QuickAddDateTimeSheet: View {
    let title: String
    let initial: Date
    /// When false the time is always set (a reminder needs one).
    var timeIsOptional = true
    var initiallyTimed = false
    /// A reminder in the past would never fire.
    var requiresFuture = false
    let onDone: (_ date: Date, _ timed: Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var hasTime = false

    private var isTimed: Bool { hasTime || !timeIsOptional }

    var body: some View { sheetContent.macSheetFrame() }

    @ViewBuilder private var sheetContent: some View {
        NavigationStack {
            Form {
                DatePicker(title, selection: $date, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .labelsHidden()
                if timeIsOptional {
                    Toggle("Time", isOn: $hasTime.animation())
                }
                if isTimed {
                    DatePicker("Time", selection: $date, displayedComponents: .hourAndMinute)
                }
                if requiresFuture && date <= Date() {
                    Text("Pick a future time").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") {
                        onDone(date, isTimed)
                        dismiss()
                    }
                    .disabled(requiresFuture && date <= Date())
                }
            }
        }
        .onAppear {
            date = initial
            hasTime = initiallyTimed
        }
    }
}

/// The sheet quick add opens for a picker: the due date, labels or a custom reminder.
struct QuickAddPickerSheetView: View {
    let which: QuickAddPickerSheet
    let services: AppServices
    let dueISO: String
    @Binding var labelTitles: [String]
    @Binding var reminders: [QuickAddReminder]
    let onDue: (String) -> Void

    var body: some View {
        switch which {
        case .date:
            DateSheet(title: "Date", iso: dueISO.isEmpty ? nil : dueISO) { iso, _ in onDue(iso) }
        case .labels:
            QuickAddLabelPicker(services: services, selected: $labelTitles)
        case .reminder:
            QuickAddDateTimeSheet(
                title: "Remind at", initial: reminderStart, timeIsOptional: false, requiresFuture: true
            ) { date, _ in
                let reminder = QuickAddReminder.atTime(DueDates.timedISO(date))
                if !reminders.contains(reminder) { reminders.append(reminder) }
            }
        }
    }

    /// An hour before a timed due date when that is still ahead, else the next whole hour.
    private var reminderStart: Date {
        let now = Date()
        if DueDates.hasTimeOfDay(dueISO), let due = DueDates.parse(dueISO), due.addingTimeInterval(-3600) > now {
            return due.addingTimeInterval(-3600)
        }
        return Calendar.cria.dateInterval(of: .hour, for: now)?.end ?? now.addingTimeInterval(3600)
    }
}
