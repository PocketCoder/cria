import CriaKit
import Foundation
import SwiftUI

/// The task fields the push compares before an update (`taskConflictFields`, less the hidden position).
enum ConflictField: String, CaseIterable, Identifiable {
    case title, description, done
    case dueDate = "due_date", startDate = "start_date", endDate = "end_date"
    case priority, progress = "percent_done", colour = "hex_color"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .title: "Title"
        case .description: "Description"
        case .done: "Done"
        case .dueDate: "Due"
        case .startDate: "Start"
        case .endDate: "End"
        case .priority: "Priority"
        case .progress: "Progress"
        case .colour: "Colour"
        }
    }
}

/// One side of a task conflict ("Yours" or "Server"), normalised so equal values compare equal: dates by instant,
/// descriptions as plain text, colours without `#`.
struct ConflictTaskSide: Equatable {
    var title = ""
    var description = ""
    var done = false
    var dueDate: Date?
    var startDate: Date?
    var endDate: Date?
    /// Stored ISO values, for the app's date labels (all-day versus timed).
    var dueISO: String?
    var startISO: String?
    var endISO: String?
    var priority = 0
    /// 0 to 1.
    var progress = 0.0
    var colour: String?

    private static let priorityNames = ["None", "Low", "Medium", "High", "Urgent", "Do now"]
    private static let descriptionLimit = 140

    init(task: TaskRecord) {
        title = task.title
        description = Self.plain(task.description)
        done = task.done
        (dueISO, dueDate) = Self.date(task.dueDate)
        (startISO, startDate) = Self.date(task.startDate)
        (endISO, endDate) = Self.date(task.endDate)
        priority = task.priority
        progress = Self.fraction(task.percentDone)
        colour = Self.colour(task.hexColor)
    }

    /// A task snapshot as the server sends it. Nil when the text is not a JSON object.
    init?(json: String) {
        guard let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { return nil }
        title = object["title"] as? String ?? ""
        description = Self.plain(object["description"] as? String)
        done = (object["done"] as? NSNumber)?.boolValue ?? false
        (dueISO, dueDate) = Self.date(object["due_date"] as? String)
        (startISO, startDate) = Self.date(object["start_date"] as? String)
        (endISO, endDate) = Self.date(object["end_date"] as? String)
        priority = (object["priority"] as? NSNumber)?.intValue ?? 0
        progress = Self.fraction((object["percent_done"] as? NSNumber)?.doubleValue ?? 0)
        colour = Self.colour(object["hex_color"] as? String)
    }

    func matches(_ other: ConflictTaskSide, on field: ConflictField) -> Bool {
        switch field {
        case .title: title == other.title
        case .description: description == other.description
        case .done: done == other.done
        case .dueDate: dueDate == other.dueDate
        case .startDate: startDate == other.startDate
        case .endDate: endDate == other.endDate
        case .priority: priority == other.priority
        case .progress: Int((progress * 100).rounded()) == Int((other.progress * 100).rounded())
        case .colour: colour == other.colour
        }
    }

    func text(_ field: ConflictField, display: DateDisplay) -> String {
        switch field {
        case .title: title.isEmpty ? "None" : title
        case .description: description.isEmpty ? "None" : description
        case .done: done ? "Yes" : "No"
        case .dueDate: Self.label(dueISO, display: display)
        case .startDate: Self.label(startISO, display: display)
        case .endDate: Self.label(endISO, display: display)
        case .priority: Self.priorityNames.indices.contains(priority) ? Self.priorityNames[priority] : "\(priority)"
        case .progress: "\(Int((progress * 100).rounded()))%"
        case .colour: colour.map { "#\($0)" } ?? "None"
        }
    }

    /// The swatch for the colour row.
    var swatch: Color? { Color(hexString: colour) }

    private static func label(_ iso: String?, display: DateDisplay) -> String {
        guard let iso else { return "None" }
        return DueDates.label(iso, now: Date(), display: display)
    }

    private static func date(_ raw: String?) -> (String?, Date?) {
        guard let iso = normaliseDate(raw), let date = DueDates.parse(iso) else { return (nil, nil) }
        return (iso, date)
    }

    /// Plain text from the rich-text description, on one line and cut short.
    private static func plain(_ html: String?) -> String {
        guard let html, !html.isEmpty else { return "" }
        let text = AIPrompts.stripHtml(html)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        return text.count > descriptionLimit ? "\(text.prefix(descriptionLimit))…" : text
    }

    /// Accepts 0 to 1 or 0 to 100.
    private static func fraction(_ value: Double) -> Double {
        value > 1 ? value / 100 : value
    }

    private static func colour(_ raw: String?) -> String? {
        let hex = raw?.trimmingCharacters(in: CharacterSet(charactersIn: "# ")).lowercased() ?? ""
        return hex.isEmpty ? nil : hex
    }
}
