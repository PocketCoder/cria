import CriaKit
import SwiftUI

/// One filter the search parser found, shown as a chip above the results.
struct SearchFilterChip: Identifiable {
    let id: String
    let text: String
    let systemImage: String
    let tint: Color
}

/// Turns a parsed search into chips: due dates (or overdue), label, priority, and the text still searched for.
enum SearchFilterChips {
    private static let priorityNames = ["None", "Low", "Medium", "High", "Urgent", "Do now"]

    static func chips(for query: SearchQuery, display: DateDisplay, now: Date = Date()) -> [SearchFilterChip] {
        var chips: [SearchFilterChip] = []
        if query.onlyOpen {
            chips.append(SearchFilterChip(id: "overdue", text: "Overdue", systemImage: "exclamationmark.circle", tint: Color(.destructive)))
        } else if let due = dueText(start: query.dueDateStart, end: query.dueDateEnd, display: display, now: now) {
            chips.append(SearchFilterChip(id: "due", text: due, systemImage: "calendar", tint: Color(.sky700)))
        }
        if let label = query.labelTitle {
            chips.append(SearchFilterChip(id: "label", text: label, systemImage: "tag", tint: Color(.meadow700)))
        }
        if let priority = query.priority {
            chips.append(SearchFilterChip(
                id: "priority", text: "Priority \(name(priority))", systemImage: "flag", tint: Color(.marigold700)
            ))
        }
        if let minimum = query.minimumPriority {
            chips.append(SearchFilterChip(
                id: "minimumPriority", text: "\(name(minimum)) priority or above", systemImage: "flag", tint: Color(.marigold700)
            ))
        }
        let text = query.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !chips.isEmpty && !text.isEmpty {
            chips.append(SearchFilterChip(
                id: "text", text: "\u{201C}\(text)\u{201D}", systemImage: "magnifyingglass", tint: Color(.mutedForeground)
            ))
        }
        return chips
    }

    private static func name(_ priority: Int) -> String {
        priorityNames.indices.contains(priority) ? priorityNames[priority] : "\(priority)"
    }

    /// The parser emits UTC day bounds; their `yyyy-MM-dd` part is the local day that was meant.
    private static func dueText(start: String?, end: String?, display: DateDisplay, now: Date) -> String? {
        guard let end, let last = dayLabel(end, display: display, now: now) else { return nil }
        guard let start, let first = dayLabel(start, display: display, now: now) else { return "Due by \(last)" }
        return start.prefix(10) == end.prefix(10) ? "Due \(first)" : "Due \(first) to \(last)"
    }

    private static func dayLabel(_ iso: String, display: DateDisplay, now: Date) -> String? {
        guard iso.count >= 10 else { return nil }
        let label = DueDates.label(String(iso.prefix(10)) + "T00:00:00Z", now: now, display: display)
        guard !label.isEmpty else { return nil }
        return ["Today", "Tomorrow", "Yesterday"].contains(label) ? label.lowercased() : label
    }
}
