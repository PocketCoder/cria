import CriaKit
import SwiftUI

/// Seven day buttons for the week of the selected day, between previous and next week chevrons. A dot marks days
/// with open tasks.
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
        HStack(spacing: 0) {
            weekButton("Previous week", systemImage: "chevron.left", by: -7)
            ForEach(days, id: \.self) { day in dayButton(day) }
            weekButton("Next week", systemImage: "chevron.right", by: 7)
        }
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
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(isSelected ? Color(.primarySoft) : .clear, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(day.formatted(.dateTime.weekday(.wide).day().month(.wide)))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
