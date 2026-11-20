import Foundation

/// Table rows in manual order with each subtask moved under its parent, when its parent is in the table too. Works on
/// task local ids, so the app keeps its row type.
public enum TableNesting {
    /// Subtask to parent, for pairs that are both in `ids`.
    public static func parents(of ids: [String], children: [String: [String]]) -> [String: String] {
        let present = Set(ids)
        var parentOf: [String: String] = [:]
        for (parent, kids) in children where present.contains(parent) {
            for kid in kids where present.contains(kid) && kid != parent { parentOf[kid] = parent }
        }
        return parentOf
    }

    /// The ids with every subtask placed after its parent (and its parent's earlier subtasks); the rest keep their
    /// order. Every id comes back exactly once, a loop in the parent links included.
    public static func nested(_ ids: [String], children: [String: [String]]) -> [String] {
        let parentOf = parents(of: ids, children: children)
        guard !parentOf.isEmpty else { return ids }
        var kids: [String: [String]] = [:]
        for id in ids {
            if let parent = parentOf[id] { kids[parent, default: []].append(id) }
        }
        var out: [String] = []
        var seen = Set<String>()
        func visit(_ id: String) {
            guard seen.insert(id).inserted else { return }
            out.append(id)
            for kid in kids[id] ?? [] { visit(kid) }
        }
        for id in ids where parentOf[id] == nil { visit(id) }
        // Rows in a loop of parent links have no root to start from: they keep their place at the end.
        for id in ids { visit(id) }
        return out
    }

    /// Each id's depth under a parent that comes before it in `ids`; 0 otherwise.
    public static func depths(_ ids: [String], children: [String: [String]]) -> [String: Int] {
        let parentOf = parents(of: ids, children: children)
        var depths: [String: Int] = [:]
        for id in ids {
            if let parent = parentOf[id], let above = depths[parent] { depths[id] = above + 1 } else { depths[id] = 0 }
        }
        return depths
    }
}

/// Upcoming's quiet days: after the first few days, two or more empty days in a row fold into one section.
public enum QuietDays {
    /// A folded run's key starts with this; it has no items and no New Task row.
    public static let keyPrefix = "quiet_"

    /// A day section's key: `yyyy-MM-dd`.
    public static func isDayKey(_ key: String) -> Bool {
        let parts = key.split(separator: "-")
        return parts.count == 3 && parts.allSatisfy { Int($0) != nil }
    }

    /// `sections` with each run of two or more quiet days (by default: no tasks) after the first `keepFirst` days
    /// replaced by one section labelled "<first> – <last>", each end named by `dayLabel` from its key. Other sections
    /// are kept as they are.
    public static func fold(
        _ sections: [DisplaySection], keepFirst: Int = 3,
        isQuiet: (DisplaySection) -> Bool = { $0.items.isEmpty }, dayLabel: (String) -> String
    ) -> [DisplaySection] {
        var out: [DisplaySection] = []
        var run: [DisplaySection] = []
        var daysSeen = 0
        func flush() {
            if run.count >= 2, let first = run.first, let last = run.last {
                out.append(DisplaySection(
                    key: keyPrefix + first.key.replacingOccurrences(of: "-", with: ""),
                    label: dayLabel(first.key) + " – " + dayLabel(last.key), items: []
                ))
            } else {
                out += run
            }
            run = []
        }
        for section in sections {
            let isDay = isDayKey(section.key)
            if isDay { daysSeen += 1 }
            if isDay, daysSeen > keepFirst, isQuiet(section) {
                run.append(section)
            } else {
                flush()
                out.append(section)
            }
        }
        flush()
        return out
    }
}
