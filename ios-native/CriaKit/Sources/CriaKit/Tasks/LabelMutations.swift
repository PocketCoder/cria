import Foundation
import GRDB

extension CriaStore {
    /// User mutation: a new label, queued for create.
    @discardableResult
    public func createLabel(title: String, hexColor: String? = nil) throws -> LabelRecord {
        try userWrite(announcing: [.labels, .outbox]) { connection in
            let localId = UUID().uuidString
            let now = isoNow()
            try connection.execute(sql: """
                INSERT INTO labels (local_id, server_id, title, description, hex_color, updated_at, dirty, deleted)
                VALUES (?, NULL, ?, NULL, ?, ?, 1, 0)
                """, arguments: [localId, title, hexColor, now])
            guard let row = try Row.fetchOne(
                connection, sql: "SELECT \(CriaStore.labelColumns) FROM labels WHERE local_id = ?", arguments: [localId]
            ) else { throw CriaStoreError.notFound(localId) }
            try connection.enqueue(.label, localId: localId, operation: .create, payload: [
                "title": title,
                "hex_color": jsonNullable(hexColor)
            ], at: now)
            return LabelRecord(row: row)
        }
    }

    /// Links labels to a task by title, creating any that do not exist yet (case-insensitive match). A label
    /// already on the task is left alone. Ported from `applyLabelsByTitle` in `src/db/labels.ts`.
    public func applyLabels(byTitle titles: [String], toTask taskLocalId: String) throws {
        var seen = Set<String>()
        var ordered: [String] = []
        for raw in titles {
            let title = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if !title.isEmpty, seen.insert(title.lowercased()).inserted { ordered.append(title) }
        }
        guard !ordered.isEmpty else { return }
        var lookup = Dictionary(try labels().map { ($0.title.lowercased(), $0.localId) }, uniquingKeysWith: { first, _ in first })
        let already = Set(try labels(forTask: taskLocalId).map(\.localId))
        for title in ordered {
            let labelId: String
            if let existing = lookup[title.lowercased()] {
                labelId = existing
            } else {
                labelId = try createLabel(title: title).localId
                lookup[title.lowercased()] = labelId
            }
            if !already.contains(labelId) {
                try toggleTaskLabel(taskLocalId: taskLocalId, labelLocalId: labelId)
            }
        }
    }
}
