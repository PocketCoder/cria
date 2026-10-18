#if os(macOS)
import CriaKit
import SwiftUI

/// The Mac's smart view pieces from the design: the subtitle, the New Task rows, the group headers, and the extra
/// sections (Today's group under Overdue, every remaining day of Upcoming's week).
extension SmartViewScreen {
    /// "Sunday 11 October · 3 tasks" on Today, the month on Upcoming, the open count elsewhere.
    var macSubtitle: String? {
        let count = openCount == 1 ? "1 task" : "\(openCount) tasks"
        switch view {
        case .today: return Date().formatted(.dateTime.weekday(.wide).day().month(.wide)) + " · " + count
        case .upcoming: return subtitle
        default: return live.value.loaded ? count : nil
        }
    }

    /// Today keeps its group (and New Task row) under Overdue even with nothing due today; Upcoming lists every day
    /// from the selected one to the end of its week, empty or not, after any Overdue group.
    func macArranged(_ sections: [DisplaySection]) -> [DisplaySection] {
        switch view {
        case .today:
            guard sections.contains(where: { $0.key == "overdue" }), !sections.contains(where: { $0.key == "today" }) else {
                return sections
            }
            return sections + [DisplaySection(key: "today", label: "Today", items: [])]
        case .upcoming:
            guard display.config.groupBy == .none else { return sections }
            var byKey = Dictionary(sections.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
            for day in remainingWeek() {
                let key = Self.dayKey(day)
                if byKey[key] == nil { byKey[key] = DisplaySection(key: key, label: key, items: []) }
            }
            // "overdue" first, then the days in date order (their keys are yyyy-MM-dd).
            return byKey.values.sorted { lhs, rhs in
                if lhs.key == "overdue" || rhs.key == "overdue" { return lhs.key == "overdue" && rhs.key != "overdue" }
                return lhs.key < rhs.key
            }
        default:
            return sections
        }
    }

    /// The selected day and the rest of its week, as the strip shows it.
    private func remainingWeek() -> [Date] {
        var calendar = Calendar.cria
        calendar.firstWeekday = weekStart + 1
        guard let week = calendar.dateInterval(of: .weekOfYear, for: selectedDay) else { return [selectedDay] }
        var days: [Date] = []
        var day = calendar.startOfDay(for: selectedDay)
        while day < week.end {
            days.append(day)
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }
        return days
    }

    @ViewBuilder func macNewTaskRow(_ group: DisplaySection) -> some View {
        if let day = MacSmartHeader.newTaskDay(view, groupKey: group.key) {
            MacNewTaskRow {
                addDay = day
                addPresented = true
            }
        } else if isInbox, let project = live.value.inboxLocalId {
            MacNewTaskRow {
                addProject = project
                addPresented = true
            }
        }
    }

    /// Overdue in coral (with Today's reschedule action); Upcoming's days as "Today · Sunday" (in the accent),
    /// "Tomorrow · Monday" and "Tuesday 13 Oct".
    @ViewBuilder func macGroupHeader(_ group: DisplaySection) -> some View {
        if group.key == "overdue" {
            MacGroupHeader(
                title: group.label, count: group.items.count, tint: MacTheme.coral,
                actionTitle: view == .today ? "Reschedule to today" : nil,
                action: view == .today ? { rescheduling = group } : nil
            )
        } else if !isInbox {
            let open = group.items.filter { !$0.task.done }.count
            let day = view == .upcoming ? MacSmartHeader.newTaskDay(view, groupKey: group.key) : nil
            let isToday = day.map { Calendar.cria.isDateInToday($0) } ?? false
            MacGroupHeader(
                title: day.map(MacSmartHeader.dayTitle) ?? group.label,
                count: open > 0 ? open : nil, tint: isToday ? Color(.primary) : Color(.foreground)
            )
        }
    }
}
#endif
