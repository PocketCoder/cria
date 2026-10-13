import Foundation

public enum GanttDragMode: Equatable, Sendable {
    case move, resizeStart, resizeEnd
}

/// A bar drag in progress, measured in whole days.
public struct GanttDrag: Equatable, Sendable {
    public let taskLocalId: String
    public let mode: GanttDragMode
    public let originalStart: Int
    public let originalEnd: Int
    public var deltaDays: Int

    public init(taskLocalId: String, mode: GanttDragMode, originalStart: Int, originalEnd: Int, deltaDays: Int = 0) {
        self.taskLocalId = taskLocalId
        self.mode = mode
        self.originalStart = originalStart
        self.originalEnd = originalEnd
        self.deltaDays = deltaDays
    }
}

/// The visible day range, inclusive.
public struct GanttDayRange: Equatable, Sendable {
    public let today: Int
    public let low: Int
    public let high: Int
    public var totalDays: Int { high - low + 1 }
}

public struct GanttDays: Equatable, Sendable {
    public let start: Int
    public let end: Int
    public let dateless: Bool
}

public struct GanttMonth: Equatable, Sendable {
    public let label: String
    public let left: Double
    public let width: Double
}

/// One header tick: a day number at day zoom, the first day of each week at week zoom.
public struct GanttTick: Equatable, Sendable {
    public let day: Int
    /// Day of the month.
    public let label: String
    public let left: Double
    public let isWeekend: Bool
}

public struct GanttPlacement: Equatable, Sendable {
    public let taskLocalId: String
    public let resolved: GanttDays
    public let left: Double
    public let width: Double
    public let top: Double
    public let height: Double
    /// A valid `#rrggbb` task colour, or nil for the base colour.
    public let color: String?
    public let isPlaceholder: Bool
    public let label: String
}

/// Ported from `ganttGeometry.ts`.
public enum GanttGeometry {
    static let monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ]

    /// A `#`-prefixed hex colour, or nil for empty or malformed input.
    public static func normalizeColor(_ hex: String?) -> String? {
        guard let hex else { return nil }
        var text = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("#") { text.removeFirst() }
        let isHex = text.allSatisfy { $0.isHexDigit }
        guard isHex, text.count == 3 || text.count == 6 else { return nil }
        return "#" + text
    }

    /// Visible range, tolerant of swapped from and to dates. `now` is a Unix time in seconds.
    public static func dayRange(from fromISO: String, to toISO: String, now: Double, calendar: Calendar = .cria) -> GanttDayRange? {
        guard let rawFrom = GanttTree.day(fromISO: fromISO), let rawTo = GanttTree.day(fromISO: toISO) else { return nil }
        let today = GanttTree.localDay(of: Date(timeIntervalSince1970: now), calendar: calendar)
        return GanttDayRange(today: today, low: min(rawFrom, rawTo), high: max(rawFrom, rawTo))
    }

    /// Resolves a node's drawn days, filling partial and dateless bars.
    public static func resolveBarDays(_ node: GanttNode, range: GanttDayRange) -> GanttDays {
        let span = GanttMetrics.defaultSpanDays
        switch (node.startDay, node.endDay) {
        case (nil, nil):
            let anchor = min(max(range.today, range.low), range.high)
            return GanttDays(start: anchor, end: anchor + span - 1, dateless: true)
        case let (start?, nil): return GanttDays(start: start, end: start + span - 1, dateless: false)
        case let (nil, end?): return GanttDays(start: end - span + 1, end: end, dateless: false)
        case let (start?, end?): return GanttDays(start: start, end: end, dateless: false)
        }
    }

    /// Start and end after applying a drag. Resizing never crosses the opposite edge.
    public static func apply(_ drag: GanttDrag) -> GanttDays {
        let start = drag.originalStart
        let end = drag.originalEnd
        switch drag.mode {
        case .move: return GanttDays(start: start + drag.deltaDays, end: end + drag.deltaDays, dateless: false)
        case .resizeStart: return GanttDays(start: min(start + drag.deltaDays, end), end: end, dateless: false)
        case .resizeEnd: return GanttDays(start: start, end: max(end + drag.deltaDays, start), dateless: false)
        }
    }

    /// Header month spans for the day range starting at `low`.
    public static func monthGroups(low: Int, totalDays: Int, dayWidth: Double = GanttMetrics.dayWidth) -> [GanttMonth] {
        var groups: [GanttMonth] = []
        var index = 0
        while index < totalDays {
            let key = monthKey(low + index)
            var span = 0
            while index + span < totalDays && monthKey(low + index + span) == key { span += 1 }
            groups.append(GanttMonth(
                label: "\(monthNames[key.month]) \(key.year)", left: Double(index) * dayWidth, width: Double(span) * dayWidth
            ))
            index += span
        }
        return groups
    }

    private struct MonthKey: Equatable {
        let year: Int
        let month: Int
    }

    private static func monthKey(_ day: Int) -> MonthKey {
        let parts = TaskDayCalendar.utc.dateComponents([.year, .month], from: Date(timeIntervalSince1970: Double(day) * 86_400))
        return MonthKey(year: parts.year ?? 1970, month: (parts.month ?? 1) - 1)
    }

    /// Chart height: the header and one row per bar, but never shorter than `minimum` (the visible area), so the
    /// grid and the today line reach the bottom of the screen even with few or no bars.
    public static func chartHeight(rowCount: Int, minimum: Double) -> Double {
        max(GanttMetrics.headerHeight + Double(max(rowCount, 0)) * GanttMetrics.rowHeight, minimum)
    }

    /// Calendar weekday (1 is Sunday) of a day number. Day 0, 1970-01-01, was a Thursday.
    public static func weekday(of day: Int) -> Int {
        ((day + 4) % 7 + 7) % 7 + 1
    }

    /// Header ticks: every day at day zoom, else the first day of each week (`firstWeekday` uses the calendar's
    /// numbering, 1 for Sunday).
    public static func dayTicks(
        low: Int, totalDays: Int, dayWidth: Double, weekly: Bool, firstWeekday: Int = 2
    ) -> [GanttTick] {
        guard totalDays > 0 else { return [] }
        return (0..<totalDays).compactMap { index in
            let day = low + index
            let weekday = weekday(of: day)
            if weekly && weekday != firstWeekday { return nil }
            let date = Date(timeIntervalSince1970: Double(day) * 86_400)
            let dayOfMonth = TaskDayCalendar.utc.component(.day, from: date)
            return GanttTick(
                day: day, label: String(dayOfMonth), left: Double(index) * dayWidth, isWeekend: weekday == 1 || weekday == 7
            )
        }
    }

    /// The day under an x position in the chart, clamped to the visible range. Used to place a dropped task.
    public static func day(atX xPosition: Double, range: GanttDayRange, dayWidth: Double) -> Int {
        guard dayWidth > 0 else { return range.today }
        let offset = Int((xPosition / dayWidth).rounded(.down))
        return min(max(range.low + offset, range.low), range.high)
    }

    /// Bar geometry for each visible row, so bars and arrows share coordinates.
    public static func placements(
        visible: [GanttNode], range: GanttDayRange, drag: GanttDrag?, chartWidth: Double, dayWidth: Double = GanttMetrics.dayWidth
    ) -> [GanttPlacement] {
        visible.enumerated().map { index, node in
            let resolved = resolveBarDays(node, range: range)
            var drawn = resolved
            if let drag, drag.taskLocalId == node.taskLocalId { drawn = apply(drag) }
            let rawX = Double(drawn.start - range.low) * dayWidth
            let rawWidth = Double(drawn.end - drawn.start + 1) * dayWidth
            let left = max(0, rawX)
            let right = min(chartWidth, rawX + rawWidth)
            return GanttPlacement(
                taskLocalId: node.taskLocalId, resolved: resolved, left: left, width: max(4, right - left),
                top: Double(index) * GanttMetrics.rowHeight + 8, height: GanttMetrics.rowHeight - 16,
                color: normalizeColor(node.hexColor), isPlaceholder: resolved.dateless || node.hasDerivedDates,
                label: "\(GanttTree.dayText(drawn.start)) \u{2192} \(GanttTree.dayText(drawn.end))"
            )
        }
    }
}

/// A fixed UTC Gregorian calendar for day numbers.
enum TaskDayCalendar {
    static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }()
}
