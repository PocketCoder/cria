import CriaKit
import SwiftUI

/// Seven day buttons for the week of the selected day, between previous and next week chevrons. A dot marks days
/// with open tasks. Nine fixed columns cannot grow with every text size, so the strip stops at xxxLarge and a long
/// press shows the large content viewer instead, as tab bars do.
struct WeekStrip: View {
    @Binding var selected: Date
    let busyDays: Set<String>

    @AppStorage(GeneralSettings.weekStartDefaultsKey) private var weekStart = GeneralSettings.defaultWeekStart

    private var days: [Date] {
        var calendar = Calendar.cria
        calendar.firstWeekday = weekStart + 1
        let start = calendar.dateInterval(of: .weekOfYear, for: selected)?.start ?? selected
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    var body: some View {
        #if os(macOS)
        // The macOS design's strip: seven equal days, no chevrons (the header has ‹, Today and ›).
        HStack(spacing: 4) {
            ForEach(days, id: \.self) { day in
                MacWeekDay(day: day, selected: $selected, busy: busyDays.contains(DueDates.dayKey(DueDates.allDayISO(for: day)) ?? ""))
            }
        }
        #else
        HStack(spacing: 0) {
            weekButton("Previous week", systemImage: "chevron.left", by: -7)
            ForEach(days, id: \.self) { day in dayButton(day) }
            weekButton("Next week", systemImage: "chevron.right", by: 7)
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .sensoryFeedback(.selection, trigger: selected)
        #endif
    }

    private func weekButton(_ title: String, systemImage: String, by days: Int) -> some View {
        Button {
            let calendar = Calendar.cria
            selected = calendar.date(byAdding: .day, value: days, to: selected).map { calendar.startOfDay(for: $0) } ?? selected
        } label: {
            Image(systemName: systemImage)
                .font(Theme.rowSubtitle.weight(.semibold))
                .foregroundStyle(Color(.mutedForeground))
                .frame(width: 28)
                .frame(minHeight: 64)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityShowsLargeContentViewer { Label(title, systemImage: systemImage) }
    }

    private func dayButton(_ day: Date) -> some View {
        let calendar = Calendar.cria
        let isSelected = calendar.isDate(day, inSameDayAs: selected)
        let isToday = calendar.isDateInToday(day)
        let busy = busyDays.contains(DueDates.dayKey(DueDates.allDayISO(for: day)) ?? "")
        return Button { selected = calendar.startOfDay(for: day) } label: {
            VStack(spacing: 4) {
                Text(day.formatted(.dateTime.weekday(.narrow))).font(Theme.chip)
                    .foregroundStyle(Color(.mutedForeground))
                Text(day.formatted(.dateTime.day()))
                    .font(.title3.weight(isSelected || isToday ? .semibold : .regular))
                    .foregroundStyle(isSelected ? Color(.primary) : Color(.foreground))
                Circle().fill(busy ? (isSelected ? Color(.primary) : Color(.mutedForeground)) : .clear)
                    .frame(width: 5, height: 5)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(isSelected ? Color(.primarySoft) : .clear, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).day().month(.wide)))
        .accessibilityValue([isToday ? "Today" : nil, busy ? "Has tasks" : nil].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityShowsLargeContentViewer { Text(day.formatted(.dateTime.weekday(.abbreviated).day())) }
    }
}

#if os(macOS)
/// One day of the Mac strip: the weekday over a 30pt date circle, solid accent when selected, accent text for today,
/// a hover fill, and a dot when the day has tasks.
private struct MacWeekDay: View {
    let day: Date
    @Binding var selected: Date
    let busy: Bool
    @State private var hovering = false

    var body: some View {
        let calendar = Calendar.cria
        let isSelected = calendar.isDate(day, inSameDayAs: selected)
        let isToday = calendar.isDateInToday(day)
        let accent = isToday && !isSelected
        Button { selected = calendar.startOfDay(for: day) } label: {
            VStack(spacing: 3) {
                // The weekday is in the accent for the selected day too; Semibold only for today.
                Text(day.formatted(.dateTime.weekday(.abbreviated)))
                    .font(.system(size: 11, weight: accent ? .semibold : .medium))
                    .foregroundStyle(accent || isSelected ? Color(.primary) : MacTheme.label2)
                Text(day.formatted(.dateTime.day()))
                    .font(.system(size: 15, weight: isSelected || isToday ? .semibold : .medium))
                    .monospacedDigit()
                    .foregroundStyle(isSelected ? Color(.primaryForeground) : (accent ? Color(.primary) : Color(.foreground)))
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(isSelected ? Color(.primary) : (hovering ? MacTheme.fill : Color.clear)))
                    .animation(.easeOut(duration: 0.16), value: isSelected)
                    .animation(.easeOut(duration: 0.16), value: hovering)
                Circle().fill(busy ? MacTheme.label3 : Color.clear).frame(width: 4, height: 4)
            }
            .lineLimit(1)
            .frame(maxWidth: .infinity)
            .frame(height: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).day().month(.wide)))
        .accessibilityValue([isToday ? "Today" : nil, busy ? "Has tasks" : nil].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
#endif
