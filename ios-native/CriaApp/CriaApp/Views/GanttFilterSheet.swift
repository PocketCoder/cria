import CriaKit
import SwiftUI

/// The Gantt's date range and its tray of tasks with no dates, remembered on this device. Until a date is chosen the
/// range follows the tasks. Ported from `useGanttFilters.ts`.
struct GanttFilterSheet: View {
    @Binding var filters: GanttFilters
    /// The range the tasks give on their own: what the pickers show until a date is chosen.
    let automatic: GanttDayRange
    @Environment(\.dismiss) private var dismiss

    var body: some View { sheetContent.macSheetFrame() }

    @ViewBuilder private var sheetContent: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("From", selection: picker(\.fromDay, fallback: automatic.low), displayedComponents: .date)
                    DatePicker("To", selection: picker(\.toDay, fallback: automatic.high), displayedComponents: .date)
                } header: {
                    Text("Date range")
                } footer: {
                    Text("Bars outside the range are hidden. Until you pick a date, the range follows your tasks.")
                }
                Section {
                    Toggle("Show tasks without dates", isOn: $filters.showUndated)
                }
                if filters.isActive {
                    Section {
                        Button("Reset", role: .destructive) { filters = .standard }
                    }
                }
            }
            .criaSurface()
            .navigationTitle("Gantt filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }

    /// A date picker over one of the range's day numbers.
    private func picker(_ day: WritableKeyPath<GanttFilters, Int?>, fallback: Int) -> Binding<Date> {
        Binding(
            get: { GanttFilters.date(forDay: filters[keyPath: day] ?? fallback) },
            set: { filters[keyPath: day] = GanttFilters.day(for: $0) }
        )
    }
}
