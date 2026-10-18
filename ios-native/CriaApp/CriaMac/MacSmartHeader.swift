import CriaKit
import SwiftUI

/// The top of a smart view on the Mac: the large title and subtitle, and on Upcoming the ‹, Today and › buttons on the
/// title's line with the week strip under it.
struct MacSmartHeader: View {
    let title: String
    let subtitle: String?
    let isUpcoming: Bool
    @Binding var selectedDay: Date
    let busyDays: Set<String>

    var body: some View {
        MacContentHeader(title: title, subtitle: subtitle) {
            if isUpcoming { weekButtons }
        }
        .asListRow()
        if isUpcoming {
            WeekStrip(selected: $selectedDay, busyDays: busyDays)
                .listRowInsets(EdgeInsets(top: 0, leading: 10, bottom: 4, trailing: 10))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        }
    }

    /// A week back, the current day, a week on.
    private var weekButtons: some View {
        HStack(spacing: 6) {
            Button { shiftWeek(by: -7) } label: { Image(systemName: "chevron.left") }
                .help("Previous week")
                .accessibilityLabel("Previous week")
            Button("Today") { selectedDay = Calendar.cria.startOfDay(for: Date()) }
            Button { shiftWeek(by: 7) } label: { Image(systemName: "chevron.right") }
                .help("Next week")
                .accessibilityLabel("Next week")
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
    }

    private func shiftWeek(by days: Int) {
        let calendar = Calendar.cria
        selectedDay = calendar.date(byAdding: .day, value: days, to: selectedDay).map { calendar.startOfDay(for: $0) } ?? selectedDay
    }

    /// The day a group's New Task row fills in: today in Today's due group, the group's own day (its `yyyy-MM-dd`
    /// key) in Upcoming, none elsewhere.
    static func newTaskDay(_ view: SmartView, groupKey: String) -> Date? {
        if view == .today && groupKey == "today" { return Calendar.cria.startOfDay(for: Date()) }
        guard view == .upcoming else { return nil }
        let parts = groupKey.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.cria.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}
