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
            let ordered = byKey.values.sorted { lhs, rhs in
                if lhs.key == "overdue" || rhs.key == "overdue" { return lhs.key == "overdue" && rhs.key != "overdue" }
                return lhs.key < rhs.key
            }
            return Self.foldingQuietDays(ordered)
        default:
            return sections
        }
    }

    /// Upcoming keeps its first three days whatever they hold; after them, two or more empty days in a row fold into one
    /// quiet line ("Tue 24 – Sat 28"), so the week reads as what is planned, not a run of blank headers.
    static func foldingQuietDays(_ sections: [DisplaySection]) -> [DisplaySection] {
        var out: [DisplaySection] = []
        var run: [DisplaySection] = []
        var daysSeen = 0
        func flush() {
            if run.count >= 2, let first = run.first, let last = run.last {
                out.append(DisplaySection(
                    key: "quiet_" + first.key.replacingOccurrences(of: "-", with: ""),
                    label: quietLabel(first.key) + " – " + quietLabel(last.key), items: []
                ))
            } else {
                out += run
            }
            run = []
        }
        for section in sections {
            let isDay = MacSmartHeader.newTaskDay(.upcoming, groupKey: section.key) != nil
            if isDay { daysSeen += 1 }
            if isDay, daysSeen > 3, section.items.isEmpty {
                run.append(section)
            } else {
                flush()
                out.append(section)
            }
        }
        flush()
        return out
    }

    /// "Tue 24" for a yyyy-MM-dd key.
    private static func quietLabel(_ key: String) -> String {
        guard let day = MacSmartHeader.newTaskDay(.upcoming, groupKey: key) else { return key }
        return day.formatted(.dateTime.weekday(.abbreviated).day())
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

    /// Overdue in coral (with Today's reschedule action); Upcoming's days as a large day number with "Today",
    /// "Tomorrow" or the weekday beside it (today's number in the accent).
    @ViewBuilder func macGroupHeader(_ group: DisplaySection) -> some View {
        if group.key == "overdue" {
            MacGroupHeader(
                title: group.label, count: group.items.count, tint: MacTheme.coral,
                actionTitle: view == .today ? "Reschedule to today" : nil,
                action: view == .today ? { rescheduling = group } : nil
            )
        } else if group.key.hasPrefix("quiet_") {
            // Folded empty days: a grey line, no count and no New Task row.
            MacGroupHeader(title: group.label, tint: MacTheme.label3)
        } else if !isInbox {
            let open = group.items.filter { !$0.task.done }.count
            let day = view == .upcoming ? MacSmartHeader.newTaskDay(view, groupKey: group.key) : nil
            if let day {
                MacDayHeader(day: day, count: open > 0 ? open : nil)
            } else {
                MacGroupHeader(title: group.label, count: open > 0 ? open : nil)
            }
        }
    }
}
#endif
