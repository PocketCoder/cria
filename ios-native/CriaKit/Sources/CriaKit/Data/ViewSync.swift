import Foundation
import GRDB

/// Sync-path (silent) view writes. Split from `ViewRepository.swift` to keep files short.
extension CriaStore {
    /// Silent server merge for one view. A placeholder of the same kind is claimed in place first, so rows
    /// already pointing at it (buckets) stay valid. A dirty row is left alone. Returns the local id.
    /// `knownProjectLocalId` skips resolving `payload.projectId` (saved-filter pseudo-projects are negative).
    @discardableResult
    public func upsertViewFromServer(_ payload: ViewResponse, rawJSON: String, knownProjectLocalId: String? = nil) throws -> String {
        try database.writer.write { connection -> String in
            let projectLocalId: String
            if let known = knownProjectLocalId {
                projectLocalId = known
            } else if payload.projectId != 0, let found = try String.fetchOne(
                connection, sql: "SELECT local_id FROM projects WHERE server_id = ? LIMIT 1", arguments: [payload.projectId]
            ) {
                projectLocalId = found
            } else {
                throw ViewError.parentNotFound(payload.projectId)
            }
            return try CriaStore.mergeView(connection, payload: payload, rawJSON: rawJSON, projectLocalId: projectLocalId)
        }
    }

    /// Silent: upserts each view, then soft-deletes clean local views the server did not return.
    /// Dirty rows are spared, so a locally created view that has not pushed yet survives a pull.
    public func replaceViewsForProjectFromServer(
        projectLocalId: String, _ payloads: [(payload: ViewResponse, rawJSON: String)]
    ) throws {
        try database.writer.write { connection -> Void in
            var upserted: [String] = []
            for item in payloads {
                let localId = try CriaStore.mergeView(
                    connection, payload: item.payload, rawJSON: item.rawJSON, projectLocalId: projectLocalId
                )
                upserted.append(localId)
            }
            guard !upserted.isEmpty else { return }
            try connection.execute(sql: """
                UPDATE project_views SET deleted = 1, updated_at = ?
                 WHERE project_local_id = ? AND local_id NOT IN (\(sqlPlaceholders(upserted.count)))
                   AND deleted = 0 AND dirty = 0
                """, arguments: sqlArguments([isoNow(), projectLocalId] + upserted))
        }
    }

    /// Points a matching local placeholder at the incoming server view before the server-id lookup runs.
    static func claimPlaceholderView(
        _ connection: Database, projectLocalId: String, kind: ViewResponse.ViewKind, serverId: Int
    ) throws {
        try connection.execute(sql: """
            UPDATE project_views SET server_id = ?
             WHERE local_id = (
                    SELECT local_id FROM project_views
                     WHERE project_local_id = ? AND view_kind = ?
                       AND server_id IS NULL AND dirty = 0 AND deleted = 0
                     ORDER BY position LIMIT 1)
               AND NOT EXISTS (SELECT 1 FROM project_views WHERE server_id = ?)
            """, arguments: [serverId, projectLocalId, kind.rawValue, serverId])
    }

    static func bucketConfigurationJSON(_ values: [JSONValue]?) throws -> String? {
        guard let values else { return nil }
        let data = try JSONSerialization.data(withJSONObject: values.map(\.foundationValue), options: [.sortedKeys])
        return String(bytes: data, encoding: .utf8) ?? "[]"
    }

    static func mergeView(_ connection: Database, payload: ViewResponse, rawJSON: String, projectLocalId: String) throws -> String {
        let now = isoNow()
        let updatedAt = payload.updated ?? now
        let bucketConfig = try CriaStore.bucketConfigurationJSON(payload.bucketConfiguration)
        let mode = (payload.bucketConfigurationMode ?? ViewResponse.BucketConfigMode.none).rawValue
        try CriaStore.claimPlaceholderView(connection, projectLocalId: projectLocalId, kind: payload.viewKind, serverId: payload.id)

        let existing = try Row.fetchOne(
            connection, sql: "SELECT local_id, dirty, last_synced FROM project_views WHERE server_id = ?", arguments: [payload.id]
        )
        guard let existing else {
            let localId = UUID().uuidString
            try connection.execute(sql: """
                INSERT INTO project_views (local_id, server_id, project_local_id, title, view_kind, position, filter,
                       bucket_configuration_mode, bucket_configuration, default_bucket_server_id,
                       done_bucket_server_id, updated_at, synced_at, last_synced, dirty, deleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                """, arguments: [
                    localId, payload.id, projectLocalId, payload.title, payload.viewKind.rawValue, payload.position ?? 0,
                    payload.filter, mode, bucketConfig, payload.defaultBucketId, payload.doneBucketId,
                    updatedAt, now, rawJSON
                ])
            return localId
        }
        let localId: String = existing["local_id"]
        let dirty: Bool = existing["dirty"]
        if dirty {
            let lastSynced: String? = existing["last_synced"]
            try CriaStore.recordSyncConflict(
                connection, entity: "view", localId: localId, lastSynced: lastSynced, remoteJSON: rawJSON
            )
            return localId
        }
        try connection.execute(sql: """
            UPDATE project_views SET title = ?, view_kind = ?, position = ?, filter = ?,
                   bucket_configuration_mode = ?, bucket_configuration = ?, default_bucket_server_id = ?,
                   done_bucket_server_id = ?, updated_at = ?, synced_at = ?, last_synced = ?, dirty = 0, deleted = 0
             WHERE local_id = ? AND deleted = 0 AND dirty = 0
            """, arguments: [
                payload.title, payload.viewKind.rawValue, payload.position ?? 0, payload.filter, mode, bucketConfig,
                payload.defaultBucketId, payload.doneBucketId, updatedAt, now, rawJSON, localId
            ])
        return localId
    }

    /// Records a conflict when a dirty row's server copy moved on since the last sync. Compares title and description.
    static func recordSyncConflict(
        _ connection: Database, entity: String, localId: String, lastSynced: String?, remoteJSON: String
    ) throws {
        guard let lastSynced, lastSynced != remoteJSON else { return }
        let duplicate = try Int.fetchOne(connection, sql: """
            SELECT id FROM conflicts
             WHERE entity_type = ? AND entity_local_id = ? AND local_snapshot = ? AND remote_snapshot = ?
             LIMIT 1
            """, arguments: [entity, localId, lastSynced, remoteJSON])
        guard duplicate == nil else { return }
        guard let before = try jsonObject(lastSynced), let after = try jsonObject(remoteJSON) else { return }
        let fields = ["title", "description"].filter { field in
            (before[field] as? AnyHashable) != (after[field] as? AnyHashable)
        }
        guard !fields.isEmpty else { return }
        let fieldsData = try JSONSerialization.data(withJSONObject: fields)
        let fieldsJSON = String(bytes: fieldsData, encoding: .utf8) ?? "[]"
        try connection.execute(sql: """
            INSERT INTO conflicts (entity_type, entity_local_id, fields, local_snapshot, remote_snapshot, detected_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """, arguments: [entity, localId, fieldsJSON, lastSynced, remoteJSON, isoNow()])
    }

    /// Silent: seeds the four default views for a project that has none. Local only (clean, no outbox row), so
    /// they are never pushed; the server's views claim or replace them on the next pull. Idempotent.
    @discardableResult
    public func createDefaultViews(projectLocalId: String) throws -> [ViewRecord] {
        try database.writer.write { connection -> [ViewRecord] in
            let existingCount = try Int.fetchOne(connection, sql: """
                SELECT COUNT(*) FROM project_views WHERE project_local_id = ? AND deleted = 0
                """, arguments: [projectLocalId]) ?? 0
            if existingCount == 0 {
                let now = isoNow()
                for item in CriaStore.defaultViews {
                    try connection.execute(sql: """
                        INSERT INTO project_views (local_id, server_id, project_local_id, title, view_kind, position,
                               filter, bucket_configuration_mode, bucket_configuration, updated_at, dirty, deleted)
                        VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, NULL, ?, 0, 0)
                        """, arguments: [
                            UUID().uuidString, projectLocalId, item.title, item.kind.rawValue, item.position, item.mode, now
                        ])
                }
            }
            return try CriaStore.fetchViews(connection, projectLocalId: projectLocalId)
        }
    }
}
