import Foundation

/// Which kanban columns are collapsed to a strip, remembered per view on this device. Stored as the columns' local
/// ids joined by newlines (a local id never contains one), so it fits `@AppStorage`. The web app keeps the same set
/// in `cria:kanbanCollapsed`.
public enum KanbanCollapse {
    public static func storageKey(viewLocalId: String) -> String { "cria.kanbanCollapsed.\(viewLocalId)" }

    public static func decode(_ stored: String) -> Set<String> {
        Set(stored.split(separator: "\n").map(String.init))
    }

    public static func encode(_ ids: Set<String>) -> String {
        ids.sorted().joined(separator: "\n")
    }

    /// The stored text with one column collapsed or expanded.
    public static func toggled(_ stored: String, bucketLocalId: String) -> String {
        var ids = decode(stored)
        if ids.contains(bucketLocalId) { ids.remove(bucketLocalId) } else { ids.insert(bucketLocalId) }
        return encode(ids)
    }
}
