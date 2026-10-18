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
                // 8pt in from the rows' text edge less 4, as the design's strip (padding 0 8).
                .listRowInsets(EdgeInsets(top: 0, leading: 6, bottom: 0, trailing: 6))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        }
    }

    /// A week back, the current day, a week on: glass capsules, as the toolbar's buttons.
    private var weekButtons: some View {
        HStack(spacing: 6) {
            MacGlassCapsuleButton(systemImage: "chevron.left", help: "Previous week") { shiftWeek(by: -7) }
            MacGlassCapsuleButton(title: "Today", help: "Go to today") {
                selectedDay = Calendar.cria.startOfDay(for: Date())
            }
            MacGlassCapsuleButton(systemImage: "chevron.right", help: "Next week") { shiftWeek(by: 7) }
        }
    }

    private func shiftWeek(by days: Int) {
        let calendar = Calendar.cria
        selectedDay = calendar.date(byAdding: .day, value: days, to: selectedDay).map { calendar.startOfDay(for: $0) } ?? selectedDay
    }

    /// An Upcoming day group's title: "Today · Sunday", "Tomorrow · Monday", then "Tuesday 13 Oct".
    static func dayTitle(_ day: Date) -> String {
        let calendar = Calendar.cria
        let weekday = day.formatted(.dateTime.weekday(.wide))
        if calendar.isDateInToday(day) { return "Today · " + weekday }
        if calendar.isDateInTomorrow(day) { return "Tomorrow · " + weekday }
        return day.formatted(.dateTime.weekday(.wide).day().month(.abbreviated))
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

/// The design's toolbar button (`TBtn`): a 32pt glass capsule, SF 13 Medium or a 16pt symbol, 12pt sides for a title.
/// Liquid Glass on macOS 26, the bar material before.
struct MacGlassCapsuleButton: View {
    var title: String?
    var systemImage: String?
    let help: String
    let action: () -> Void

    init(title: String? = nil, systemImage: String? = nil, help: String, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.help = help
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 14, weight: .medium)) }
                if let title { Text(title).font(.system(size: 13, weight: .medium)) }
            }
            .foregroundStyle(Color(.foreground))
            .padding(.horizontal, title == nil ? 0 : 12)
            .frame(minWidth: 32, minHeight: 32)
            .background { glass }
            .contentShape(Capsule())
        }
        .buttonStyle(MacPressStyle())
        .help(help)
        .accessibilityLabel(title ?? help)
    }

    @ViewBuilder private var glass: some View {
        if #available(macOS 26, *) {
            Color.clear.glassEffect(.regular.interactive(), in: Capsule())
        } else {
            Capsule().fill(.bar)
                .overlay(Capsule().strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5))
                .shadow(color: Color(red: 40 / 255, green: 25 / 255, blue: 70 / 255).opacity(0.1), radius: 8, y: 4)
        }
    }
}
