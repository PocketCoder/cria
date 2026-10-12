import Foundation

/// The Gantt's own filters, kept on this device: an optional date range and whether tasks with no dates show in the
/// tray. A nil bound follows the tasks (the chart's automatic range). Ported from `useGanttFilters.ts`.
public struct GanttFilters: Codable, Equatable, Sendable {
    /// First day shown, as a day number (UTC days since the epoch, like the rest of the Gantt maths).
    public var fromDay: Int?
    public var toDay: Int?
    public var showUndated: Bool

    public init(fromDay: Int? = nil, toDay: Int? = nil, showUndated: Bool = true) {
        self.fromDay = fromDay
        self.toDay = toDay
        self.showUndated = showUndated
    }

    /// Tolerant of missing keys, so a stored filter from another build still loads.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        fromDay = try container.decodeIfPresent(Int.self, forKey: .fromDay)
        toDay = try container.decodeIfPresent(Int.self, forKey: .toDay)
        showUndated = try container.decodeIfPresent(Bool.self, forKey: .showUndated) ?? true
    }

    public static let standard = GanttFilters()

    /// Whether anything differs from the defaults: drives the Reset button.
    public var isActive: Bool { self != Self.standard }

    /// The range to draw: the chosen days where set, else `automatic`. Swapped bounds are put in order. Today can
    /// fall outside it, in which case the chart draws no today line.
    public func range(automatic: GanttDayRange) -> GanttDayRange {
        let first = fromDay ?? automatic.low
        let last = toDay ?? automatic.high
        let low = min(first, last)
        let high = max(first, last)
        return GanttDayRange(today: automatic.today, low: low, high: high)
    }

    /// Nodes with dates that overlap `range`. A bar wholly outside it would only draw as a stub at the edge.
    public func visible(_ nodes: [GanttNode], in range: GanttDayRange) -> [GanttNode] {
        guard fromDay != nil || toDay != nil else { return nodes }
        return nodes.filter { node in
            guard node.startDay != nil || node.endDay != nil else { return true }
            let start = node.startDay ?? node.endDay ?? range.low
            let end = node.endDay ?? node.startDay ?? range.high
            return end >= range.low && start <= range.high
        }
    }

    /// The calendar day `day` names, as a date at the start of that day in the user's time zone, for a date picker.
    public static func date(forDay day: Int, calendar: Calendar = .cria) -> Date {
        let utc = Date(timeIntervalSince1970: Double(day) * 86_400)
        let parts = TaskDayCalendar.utc.dateComponents([.year, .month, .day], from: utc)
        return calendar.date(from: parts) ?? utc
    }

    /// The day number a picked date falls on in the user's time zone. The inverse of `date(forDay:)`.
    public static func day(for date: Date, calendar: Calendar = .cria) -> Int {
        GanttTree.localDay(of: date, calendar: calendar)
    }

    public var stored: String {
        guard isActive, let data = try? JSONEncoder().encode(self) else { return "" }
        return String(bytes: data, encoding: .utf8) ?? ""
    }

    public static func from(stored text: String) -> GanttFilters {
        guard let data = text.data(using: .utf8), let decoded = try? JSONDecoder().decode(GanttFilters.self, from: data) else {
            return .standard
        }
        return decoded
    }

    public static let storageKey = "cria.gantt.filters"
}
