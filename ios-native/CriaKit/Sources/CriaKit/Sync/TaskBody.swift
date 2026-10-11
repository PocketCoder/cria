import Foundation

/// Wire body for a task create or update. Ported from `taskToBody` in `src/sync/push/task.ts`.
/// Every quirk here fixed a real server error: `hex_color` goes raw (a `#` causes a 500), `percent_done` is
/// 0 to 100 (the DB stores 0 to 1), `is_favorite` is always sent (omitting it breaks un-favouriting),
/// `repeat_after` and `repeat_mode` are sent even when 0, and `project_id` is included on a move.
public struct ReminderBody: Equatable, Sendable {
    public var reminder: String?
    public var relativePeriod: Int?
    public var relativeTo: String?

    public init(reminder: String? = nil, relativePeriod: Int? = nil, relativeTo: String? = nil) {
        self.reminder = reminder
        self.relativePeriod = relativePeriod
        self.relativeTo = relativeTo
    }

    var json: JSONValue {
        var object: [String: JSONValue] = [:]
        if let reminder { object["reminder"] = .string(reminder) }
        if let relativePeriod { object["relative_period"] = .number(Double(relativePeriod)) }
        if let relativeTo { object["relative_to"] = .string(relativeTo) }
        return .object(object)
    }
}

public func taskToBody(_ task: TaskRecord, projectServerId: Int? = nil, reminders: [ReminderBody]? = nil,
                       timeZone: TimeZone = .current) -> JSONBody {
    var body: JSONBody = [
        "title": .string(task.title),
        "done": .bool(task.done),
        "priority": .number(Double(task.priority)),
        "percent_done": .number((task.percentDone * 100).rounded()),
        "is_favorite": .bool(task.isFavorite),
        "repeat_after": .number(Double(task.repeatAfter)),
        "repeat_mode": .number(Double(task.repeatMode))
    ]
    if let projectServerId { body["project_id"] = .number(Double(projectServerId)) }
    if let description = task.description { body["description"] = .string(description) }
    if let due = normaliseDateForServer(task.dueDate, timeZone: timeZone) { body["due_date"] = .string(due) }
    if let start = normaliseDateForServer(task.startDate, timeZone: timeZone) { body["start_date"] = .string(start) }
    if let end = normaliseDateForServer(task.endDate, timeZone: timeZone) { body["end_date"] = .string(end) }
    var color = task.hexColor ?? ""
    if color.hasPrefix("#") { color.removeFirst() }
    if !color.isEmpty { body["hex_color"] = .string(color) }
    // Reminders ride the task update (Vikunja has no separate endpoint). An empty array clears them.
    if let reminders { body["reminders"] = .array(reminders.map(\.json)) }
    return body
}

/// Vikunja wants a full ISO 8601 datetime with an offset. A date-only value (from a date picker) becomes
/// midnight in `timeZone`. Ported from `normaliseDateForServer`.
public func normaliseDateForServer(_ date: String?, timeZone: TimeZone = .current) -> String? {
    guard let date, !date.isEmpty else { return nil }
    let hasTime = date.count > 10 && ["T", " "].contains(String(date[date.index(date.startIndex, offsetBy: 10)]))
    if hasTime { return date }
    let parts = date.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return date }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    guard let midnight = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return date }
    let offset = timeZone.secondsFromGMT(for: midnight) / 60
    let sign = offset >= 0 ? "+" : "-"
    let absolute = abs(offset)
    let pad = { (value: Int) in String(format: "%02d", value) }
    let day = "\(String(format: "%04d", parts[0]))-\(pad(parts[1]))-\(pad(parts[2]))"
    return "\(day)T00:00:00\(sign)\(pad(absolute / 60)):\(pad(absolute % 60))"
}
