import CriaKit
import SwiftUI

/// Edits a reminder that fires at a fixed date and time. Save replaces the old reminder in one change, so the task
/// is never left without it and only one update is queued. A relative reminder opens `RelativeReminderSheet` instead.
struct FixedReminderSheet: View {
    let services: AppServices
    let taskLocalId: String
    /// The reminder as it was when the sheet opened.
    let old: ReminderRecord
    @Environment(\.dismiss) private var dismiss
    @State private var date: Date
    @State private var failure: String?

    init(services: AppServices, taskLocalId: String, old: ReminderRecord) {
        self.services = services
        self.taskLocalId = taskLocalId
        self.old = old
        var start = Calendar.cria.dateInterval(of: .hour, for: Date())?.end ?? Date().addingTimeInterval(3_600)
        // A reminder that has already gone off opens on the next whole hour, ready to be moved to a future time.
        if let iso = old.reminderAt, let existing = DueDates.parse(iso), existing > Date() { start = existing }
        _date = State(initialValue: start)
    }

    private var isPast: Bool { date <= Date() }

    var body: some View { sheetContent.macSheetFrame(width: 420, height: 520) }

    @ViewBuilder private var sheetContent: some View {
        NavigationStack {
            Form {
                Section {
                    #if os(macOS)
                    // AppKit's graphical picker is a clipped mini calendar: the Cria grid and a time field instead.
                    CriaCalendar(selection: $date)
                        .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))
                    DatePicker(selection: $date, displayedComponents: .hourAndMinute) { Label("Remind at", systemImage: "clock") }
                    #else
                    DatePicker(selection: $date) { Label("Remind at", systemImage: "clock") }
                        .datePickerStyle(.graphical)
                    #endif
                } footer: {
                    if isPast { Text("Pick a future time.") }
                }
                if let failure {
                    Section { Text(failure).foregroundStyle(Color(.destructive)) }
                }
            }
            .criaSurface()
            .navigationTitle("Edit reminder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(isPast)
                }
            }
        }
        .presentationDetents([.large])
    }

    private func save() {
        guard !isPast else { return }
        do {
            try services.store.replaceReminder(
                taskLocalId: taskLocalId, old: old, with: ReminderInput(triggerAt: DueDates.timedISO(date))
            )
            dismiss()
        } catch {
            failure = String(describing: error)
        }
    }
}
