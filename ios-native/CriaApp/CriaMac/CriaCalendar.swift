import CriaKit
import SwiftUI

/// The month grid that replaces AppKit's graphical date picker in the Mac's date sheets: that one is a fixed-size
/// mini calendar that a list row measures wrongly (it was clipped), sits at the left and draws a focus ring. This one
/// fills its row and follows the design system: muted days outside the month, today in primary, the chosen day a
/// filled primary square. Weeks start on Settings > General > Week start, as the week strip does. Picking a day keeps
/// the selection's time of day, so a reminder's time survives. Arrow keys move the day once it has been clicked.
struct CriaCalendar: View {
    @Binding var selection: Date
    @AppStorage(GeneralSettings.weekStartDefaultsKey) private var weekStart = GeneralSettings.defaultWeekStart
    @State private var month: Date

    init(selection: Binding<Date>) {
        _selection = selection
        _month = State(initialValue: Self.startOfMonth(selection.wrappedValue))
    }

    private var calendar: Calendar {
        var calendar = Calendar.cria
        calendar.firstWeekday = weekStart + 1
        return calendar
    }

    var body: some View {
        VStack(spacing: 6) {
            header
            Grid(horizontalSpacing: 2, verticalSpacing: 2) {
                GridRow {
                    ForEach(weekdaySymbols, id: \.self) { symbol in
                        Text(symbol)
                            .font(Theme.caption.weight(.semibold))
                            .foregroundStyle(Color(.mutedForeground))
                            .frame(maxWidth: .infinity)
                    }
                }
                ForEach(0..<6, id: \.self) { week in
                    GridRow {
                        ForEach(0..<7, id: \.self) { weekday in dayCell(days[week * 7 + weekday]) }
                    }
                }
            }
        }
        .padding(8)
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(.leftArrow) { step(days: -1) }
        .onKeyPress(.rightArrow) { step(days: 1) }
        .onKeyPress(.upArrow) { step(days: -7) }
        .onKeyPress(.downArrow) { step(days: 7) }
        .onChange(of: selection) { _, date in
            let start = Self.startOfMonth(date)
            if start != month { month = start }
        }
    }

    private var header: some View {
        HStack(spacing: 4) {
            Text(month.formatted(.dateTime.month(.wide).year()))
                .font(Theme.headline)
                .foregroundStyle(Color(.foreground))
            Spacer()
            chevron("chevron.left", "Previous month") { shiftMonth(-1) }
            Button("Today") { pick(Date()) }
                .buttonStyle(.plain)
                .font(Theme.caption.weight(.medium))
                .foregroundStyle(Color(.primary))
                .padding(.horizontal, 6)
            chevron("chevron.right", "Next month") { shiftMonth(1) }
        }
        .padding(.horizontal, 4)
    }

    private func chevron(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(Theme.caption.weight(.semibold))
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color(.mutedForeground))
        .help(label)
        .accessibilityLabel(label)
    }

    private func dayCell(_ day: Date) -> some View {
        let inMonth = calendar.isDate(day, equalTo: month, toGranularity: .month)
        let isSelected = calendar.isDate(day, inSameDayAs: selection)
        let isToday = calendar.isDateInToday(day)
        return Button { pick(day) } label: {
            Text(day.formatted(.dateTime.day()))
                .font(isToday || isSelected ? Theme.rowTitle.weight(.semibold) : Theme.rowTitle)
                .monospacedDigit()
                .frame(maxWidth: .infinity, minHeight: 30)
                .foregroundStyle(dayColour(selected: isSelected, today: isToday, inMonth: inMonth))
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous).fill(isSelected ? Color(.primary) : Color.clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(day.formatted(date: .complete, time: .omitted))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func dayColour(selected: Bool, today: Bool, inMonth: Bool) -> Color {
        if selected { return Color(.primaryForeground) }
        if today { return Color(.primary) }
        return inMonth ? Color(.foreground) : Color(.mutedForeground).opacity(0.6)
    }

    /// Six weeks from the first day of the week that holds the 1st.
    private var days: [Date] {
        let lead = (calendar.component(.weekday, from: month) - calendar.firstWeekday + 7) % 7
        let first = calendar.date(byAdding: .day, value: -lead, to: month) ?? month
        return (0..<42).map { calendar.date(byAdding: .day, value: $0, to: first) ?? first }
    }

    private var weekdaySymbols: [String] {
        let symbols = calendar.shortStandaloneWeekdaySymbols
        let start = calendar.firstWeekday - 1
        return (0..<7).map { String(symbols[(start + $0) % 7].prefix(2)) }
    }

    /// The chosen day at the selection's time of day.
    private func pick(_ day: Date) {
        let time = calendar.dateComponents([.hour, .minute, .second], from: selection)
        selection = calendar.date(
            bySettingHour: time.hour ?? 0, minute: time.minute ?? 0, second: time.second ?? 0, of: day
        ) ?? day
    }

    private func step(days count: Int) -> KeyPress.Result {
        pick(calendar.date(byAdding: .day, value: count, to: selection) ?? selection)
        return .handled
    }

    private func shiftMonth(_ count: Int) {
        month = calendar.date(byAdding: .month, value: count, to: month) ?? month
    }

    private static func startOfMonth(_ date: Date) -> Date {
        let calendar = Calendar.cria
        return calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
    }
}
