import Foundation

/// The kanban board's own filter: text, minimum priority, labels and whether done cards show. It only hides cards
/// on this device; the board's data and its limits are untouched. Ported from `boardFilter.ts`.
public struct BoardFilter: Codable, Equatable, Sendable {
    /// Case-insensitive substring over title and description.
    public var text: String
    /// Minimum priority, 0 for any.
    public var minPriority: Int
    /// A card must carry at least one of these labels (local ids). Empty is no constraint.
    public var labelLocalIds: [String]
    /// False hides done cards.
    public var showDone: Bool

    public init(text: String = "", minPriority: Int = 0, labelLocalIds: [String] = [], showDone: Bool = true) {
        self.text = text
        self.minPriority = minPriority
        self.labelLocalIds = labelLocalIds
        self.showDone = showDone
    }

    /// Tolerant of missing keys, so a stored filter from another build still loads.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
        minPriority = try container.decodeIfPresent(Int.self, forKey: .minPriority) ?? 0
        labelLocalIds = try container.decodeIfPresent([String].self, forKey: .labelLocalIds) ?? []
        showDone = try container.decodeIfPresent(Bool.self, forKey: .showDone) ?? true
    }

    public static let empty = BoardFilter()

    /// Whether the filter would hide anything: drives the "active" mark on the button.
    public var isActive: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || minPriority > 0 || !labelLocalIds.isEmpty || !showDone
    }

    /// `labelIds` are the card's label local ids.
    public func shows(_ task: TaskRecord, labelIds: [String]) -> Bool {
        if !showDone && task.done { return false }
        if minPriority > 0 && task.priority < minPriority { return false }
        let term = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !term.isEmpty {
            let haystack = "\(task.title) \(task.description ?? "")"
            if haystack.range(of: term, options: [.caseInsensitive, .diacriticInsensitive]) == nil { return false }
        }
        if !labelLocalIds.isEmpty && !labelIds.contains(where: labelLocalIds.contains) { return false }
        return true
    }

    /// The cards of `tasks` that pass, in their order. `labels` maps a task's local id to its label local ids.
    public func apply(to tasks: [TaskRecord], labels: [String: [String]]) -> [TaskRecord] {
        guard isActive else { return tasks }
        return tasks.filter { shows($0, labelIds: labels[$0.localId] ?? []) }
    }

    /// Stored text for `@AppStorage`: empty when the filter does nothing, so an idle board keeps no entry.
    public var stored: String {
        guard isActive, let data = try? JSONEncoder().encode(self) else { return "" }
        return String(bytes: data, encoding: .utf8) ?? ""
    }

    /// Reads stored text. Anything unreadable is the empty filter; keys a newer build adds are ignored.
    public static func from(stored text: String) -> BoardFilter {
        guard let data = text.data(using: .utf8), let decoded = try? JSONDecoder().decode(BoardFilter.self, from: data) else {
            return .empty
        }
        return decoded
    }

    /// The `UserDefaults` key for one board, so each view keeps its own filter on this device.
    public static func storageKey(viewLocalId: String) -> String { "cria.kanbanFilter.\(viewLocalId)" }
}
