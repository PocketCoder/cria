#if os(macOS)
import CriaKit
import Observation
import SwiftUI

/// Tasks ticked on the screen on show. The design keeps a completed row in place, struck through, until you leave
/// the view; smart views read open tasks only, so without this the row would vanish as soon as it saved. Each screen
/// owns one (`@State`), so leaving the screen forgets them.
@MainActor @Observable
final class RecentlyCompleted {
    struct Entry {
        let item: TaskListItem
        let group: CompletionGroup?
    }

    private(set) var entries: [String: Entry] = [:]
    /// The order of the last sections shown, so a returning row goes back where it was. Not observed: it is written
    /// while the screen is drawn.
    @ObservationIgnored private var lastOrder: [String: [String]] = [:]
    @ObservationIgnored private var lastSectionKeys: [String] = []

    var isEmpty: Bool { entries.isEmpty }

    func contains(_ localId: String) -> Bool { entries[localId] != nil }

    func record(_ item: TaskListItem, group: CompletionGroup?) {
        entries[item.task.localId] = Entry(item: item, group: group)
    }

    func forget(_ localId: String) {
        entries[localId] = nil
    }

    /// The sections with every recently completed row back in its place (and its section back, if it had emptied).
    /// When completed tasks are hidden, other done rows are dropped, as the Display sheet would have.
    func merged(_ sections: [DisplaySection], showsCompleted: Bool) -> [DisplaySection] {
        guard !entries.isEmpty else {
            remember(sections)
            return sections
        }
        var result = sections.map { section -> DisplaySection in
            var copy = section
            if !showsCompleted { copy.items = section.items.filter { !$0.task.done || entries[$0.task.localId] != nil } }
            return copy
        }
        let present = Set(result.flatMap { $0.items.map(\.task.localId) })
        for (localId, entry) in entries where !present.contains(localId) {
            guard let group = entry.group else { continue }
            if let index = result.firstIndex(where: { $0.key == group.key }) {
                result[index].items = placed(entry.item, in: result[index].items, order: lastOrder[group.key] ?? [])
            } else {
                let section = DisplaySection(key: group.key, label: group.label, items: [entry.item])
                result.insert(section, at: sectionIndex(for: group.key, in: result))
            }
        }
        result.removeAll { $0.items.isEmpty }
        remember(result)
        return result
    }

    private func remember(_ sections: [DisplaySection]) {
        lastSectionKeys = sections.map(\.key)
        lastOrder = Dictionary(sections.map { ($0.key, $0.items.map(\.task.localId)) }, uniquingKeysWith: { first, _ in first })
    }

    /// After the nearest row that was above it last time, else first.
    private func placed(_ item: TaskListItem, in items: [TaskListItem], order: [String]) -> [TaskListItem] {
        var items = items
        guard let was = order.firstIndex(of: item.task.localId) else {
            items.append(item)
            return items
        }
        for above in order[..<was].reversed() {
            if let index = items.firstIndex(where: { $0.task.localId == above }) {
                items.insert(item, at: index + 1)
                return items
            }
        }
        items.insert(item, at: 0)
        return items
    }

    private func sectionIndex(for key: String, in sections: [DisplaySection]) -> Int {
        guard let was = lastSectionKeys.firstIndex(of: key) else { return sections.count }
        let after = Set(lastSectionKeys[(was + 1)...])
        return sections.firstIndex { after.contains($0.key) } ?? sections.count
    }
}

/// The section a row is drawn in, so a completed row can be put back in it.
struct CompletionGroup: Equatable {
    let key: String
    let label: String
}

private struct RecentlyCompletedKey: EnvironmentKey {
    static var defaultValue: RecentlyCompleted? { nil }
}

private struct CompletionGroupKey: EnvironmentKey {
    static var defaultValue: CompletionGroup? { nil }
}

extension EnvironmentValues {
    /// The screen's recently completed rows; nil where the screen does not keep them.
    var recentlyCompleted: RecentlyCompleted? {
        get { self[RecentlyCompletedKey.self] }
        set { self[RecentlyCompletedKey.self] = newValue }
    }

    /// The section around a row.
    var completionGroup: CompletionGroup? {
        get { self[CompletionGroupKey.self] }
        set { self[CompletionGroupKey.self] = newValue }
    }
}
#endif
