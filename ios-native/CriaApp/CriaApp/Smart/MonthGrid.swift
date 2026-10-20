import CriaKit
import SwiftUI

/// Upcoming's month view, which the week strip expands to: a title with previous and next month, the weekdays, then
/// the month's days with a dot under each that has tasks. Picking a day selects it, as in the strip. Weeks start on
/// Settings > General > Week start.
struct MonthGrid: View {
    @Binding var selected: Date
    let busyDays: Set<String>
    @AppStorage(GeneralSettings.weekStartDefaultsKey) private var weekStart = GeneralSettings.defaultWeekStart
    @State private var month: Date

    init(selected: Binding<Date>, busyDays: Set<String>) {
        _selected = selected
        self.busyDays = busyDays
        _month = State(initialValue: selected.wrappedValue)
    }

    private var calendar: Calendar {
        var calendar = Calendar.cria
        calendar.firstWeekday = weekStart + 1
        return calendar
    }

    var body: some View {
        let days = MonthGridLayout.days(forMonthContaining: month, calendar: calendar)
        VStack(spacing: 4) {
            header
            Grid(horizontalSpacing: 0, verticalSpacing: 2) {
                GridRow {
                    ForEach(weekdaySymbols, id: \.self) { symbol in
                        Text(symbol)
                            .font(Theme.chip)
                            .foregroundStyle(Color(.mutedForeground))
                            .frame(maxWidth: .infinity)
                    }
                }
                ForEach(0..<(days.count / 7), id: \.self) { week in
                    GridRow {
                        ForEach(0..<7, id: \.self) { weekday in dayCell(days[week * 7 + weekday]) }
                    }
                }
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .onChange(of: selected) { _, date in
            if !calendar.isDate(date, equalTo: month, toGranularity: .month) { month = date }
        }
    }

    private var header: some View {
        HStack(spacing: 4) {
            Text(month.formatted(.dateTime.month(.wide).year()))
                .font(Theme.headline)
                .foregroundStyle(Color(.foreground))
                .accessibilityAddTraits(.isHeader)
            Spacer()
            monthButton("Previous month", systemImage: "chevron.left", by: -1)
            monthButton("Next month", systemImage: "chevron.right", by: 1)
        }
        .padding(.horizontal, 8)
    }

    private func monthButton(_ title: String, systemImage: String, by months: Int) -> some View {
        Button {
            month = calendar.date(byAdding: .month, value: months, to: month) ?? month
        } label: {
            Image(systemName: systemImage)
                .font(Theme.rowSubtitle.weight(.semibold))
                .foregroundStyle(Color(.mutedForeground))
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    private func dayCell(_ day: Date) -> some View {
        let isSelected = calendar.isDate(day, inSameDayAs: selected)
        let isToday = calendar.isDateInToday(day)
        let inMonth = calendar.isDate(day, equalTo: month, toGranularity: .month)
        let busy = busyDays.contains(DueDates.dayKey(DueDates.allDayISO(for: day)) ?? "")
        return Button { selected = calendar.startOfDay(for: day) } label: {
            VStack(spacing: 2) {
                Text(day.formatted(.dateTime.day()))
                    .font(.body.weight(isSelected || isToday ? .semibold : .regular))
                    .monospacedDigit()
                    .foregroundStyle(isSelected ? Color(.primaryForeground) : (isToday ? Color(.primary) : Color(.foreground)))
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(isSelected ? Color(.primary) : Color.clear))
                Circle().fill(busy ? Color(.mutedForeground) : Color.clear).frame(width: 4, height: 4)
            }
            .opacity(inMonth ? 1 : 0.4)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).day().month(.wide)))
        .accessibilityValue([isToday ? "Today" : nil, busy ? "Has tasks" : nil].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var weekdaySymbols: [String] {
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        let start = calendar.firstWeekday - 1
        return (0..<7).map { symbols[(start + $0) % 7] }
    }
}
