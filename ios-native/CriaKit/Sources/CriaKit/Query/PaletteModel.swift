import Foundation

/// The sections of the command palette, in display order.
public enum PaletteGroup: String, CaseIterable, Sendable {
    case goTo = "Go to"
    case projects = "Projects"
    case labels = "Labels"
    case savedFilters = "Saved filters"
    case commands = "Commands"
    case tasks = "Tasks"
}

/// One palette row. The app attaches what choosing it does, keyed by `id`.
public struct PaletteEntry: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let group: PaletteGroup
    /// Smaller text on the right: a task's project and due date, or a key equivalent.
    public let detail: String
    public let symbol: String

    public init(id: String, title: String, group: PaletteGroup, detail: String = "", symbol: String) {
        self.id = id
        self.title = title
        self.group = group
        self.detail = detail
        self.symbol = symbol
    }
}

/// What the palette lists for the text typed: the places and commands whose title contains it, grouped in display
/// order, then the tasks the search found. Shared by the palettes of the iPad and the Mac.
public enum PaletteModel {
    /// `places` filtered by `query` (all of them when it is empty, at most `limit`), stable-sorted into display order,
    /// followed by `tasks` as they are (the search index has already matched them).
    public static func shown(places: [PaletteEntry], tasks: [PaletteEntry], query: String, limit: Int = 40) -> [PaletteEntry] {
        let text = query.trimmingCharacters(in: .whitespaces)
        let matches = text.isEmpty ? places : places.filter { $0.title.localizedCaseInsensitiveContains(text) }
        let order = PaletteGroup.allCases
        let rank = { (entry: PaletteEntry) in order.firstIndex(of: entry.group) ?? order.count }
        let sorted = Array(matches.prefix(limit)).enumerated()
            .sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }
            .map(\.element)
        return sorted + tasks
    }

    /// Consecutive entries of one group, for section headings.
    public static func sections(_ entries: [PaletteEntry]) -> [(group: PaletteGroup, entries: [PaletteEntry])] {
        var result: [(group: PaletteGroup, entries: [PaletteEntry])] = []
        for entry in entries {
            if result.last?.group == entry.group {
                result[result.count - 1].entries.append(entry)
            } else {
                result.append((group: entry.group, entries: [entry]))
            }
        }
        return result
    }

    /// The highlighted row after an arrow key: clamped, not wrapped, as the Mac palette moves.
    public static func move(_ chosen: Int, count: Int, by step: Int) -> Int {
        guard count > 0 else { return 0 }
        return min(max(chosen + step, 0), count - 1)
    }
}
