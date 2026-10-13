import GRDB
import XCTest
@testable import CriaKit

/// One outbox row with its payload, for assertions on what a mutation queued.
struct OutboxEntry: Equatable {
    let localId: String
    let operation: String
    let payload: String
}

func outboxEntries(_ store: CriaStore, entity: String) throws -> [OutboxEntry] {
    try store.database.writer.read { connection in
        try Row.fetchAll(connection, sql: """
            SELECT entity_local_id, op, payload FROM outbox WHERE entity_type = ? ORDER BY id
            """, arguments: [entity]).map { row in
            OutboxEntry(localId: row["entity_local_id"], operation: row["op"], payload: row["payload"])
        }
    }
}

func payloadObject(_ entry: OutboxEntry) throws -> [String: Any] {
    let object = try JSONSerialization.jsonObject(with: Data(entry.payload.utf8))
    return try XCTUnwrap(object as? [String: Any])
}

func viewJSON(id: Int, projectId: Int, kind: String, title: String, position: Double = 0) -> String {
    """
    {"id": \(id), "title": "\(title)", "project_id": \(projectId), "view_kind": "\(kind)", "position": \(position)}
    """
}

func bucketJSON(id: Int, viewId: Int, title: String, position: Double = 0) -> String {
    #"{"id": \#(id), "title": "\#(title)", "project_view_id": \#(viewId), "position": \#(position)}"#
}

func syncViews(_ store: CriaStore, projectLocalId: String, _ jsons: [String]) throws {
    let items = try jsons.map { json in
        (payload: try decodeFixture(ViewResponse.self, json), rawJSON: json)
    }
    try store.replaceViewsForProjectFromServer(projectLocalId: projectLocalId, items)
}

func syncBuckets(_ store: CriaStore, viewLocalId: String, _ jsons: [String]) throws {
    let items = try jsons.map { json in
        (payload: try decodeFixture(BucketResponse.self, json), rawJSON: json)
    }
    try store.replaceBucketsForViewFromServer(viewLocalId: viewLocalId, items)
}

/// Syncs a project with Vikunja's four default views (ids 11 to 14) and returns the project's local id.
@discardableResult
func seedSyncedViews(_ store: CriaStore, projectServerId: Int = 1) throws -> String {
    let projectLocalId = try seedProject(store, serverId: projectServerId)
    try syncViews(store, projectLocalId: projectLocalId, [
        viewJSON(id: 11, projectId: projectServerId, kind: "list", title: "List", position: 100),
        viewJSON(id: 12, projectId: projectServerId, kind: "gantt", title: "Gantt", position: 200),
        viewJSON(id: 13, projectId: projectServerId, kind: "table", title: "Table", position: 300),
        viewJSON(id: 14, projectId: projectServerId, kind: "kanban", title: "Kanban", position: 400)
    ])
    return projectLocalId
}

/// A project with one synced kanban view (server id `viewServerId`). Returns both local ids.
@discardableResult
func seedKanban(_ store: CriaStore, projectServerId: Int = 1, viewServerId: Int = 10) throws -> (project: String, view: String) {
    let project = try seedProject(store, serverId: projectServerId)
    let json = viewJSON(id: viewServerId, projectId: projectServerId, kind: "kanban", title: "Board")
    let view = try store.upsertViewFromServer(try decodeFixture(ViewResponse.self, json), rawJSON: json)
    return (project, view)
}

/// A synced bucket in the given view.
@discardableResult
func seedBucket(_ store: CriaStore, serverId: Int, viewServerId: Int, title: String, position: Double = 0) throws -> String {
    let json = bucketJSON(id: serverId, viewId: viewServerId, title: title, position: position)
    return try store.upsertBucketFromServer(try decodeFixture(BucketResponse.self, json), rawJSON: json)
}

/// A synced task in project server id 1 (or the given one). Returns its local id.
@discardableResult
func seedSyncedTask(_ store: CriaStore, serverId: Int, title: String = "Task", projectServerId: Int = 1) throws -> String {
    let json = taskJSON(id: serverId, projectId: projectServerId, title: title)
    let localId = try store.upsertTaskFromServer(try decodeFixture(TaskResponse.self, json), rawJSON: json)
    return try XCTUnwrap(localId)
}

func countRows(_ store: CriaStore, _ sql: String, _ arguments: StatementArguments = StatementArguments()) throws -> Int {
    try store.database.writer.read { connection in
        try Int.fetchOne(connection, sql: sql, arguments: arguments) ?? 0
    }
}

func runSQL(_ store: CriaStore, _ sql: String, _ arguments: StatementArguments = StatementArguments()) throws {
    try store.database.writer.write { connection in
        try connection.execute(sql: sql, arguments: arguments)
    }
}
