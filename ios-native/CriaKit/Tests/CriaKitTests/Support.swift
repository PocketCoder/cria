import Foundation
import XCTest
@testable import CriaKit

func decodeFixture<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
}

/// An in-memory store with migrations applied. Each test gets a fresh one.
func makeStore() throws -> CriaStore {
    CriaStore(database: try CriaDatabase.inMemory())
}

/// Syncs one project from a fixture and returns its local id.
@discardableResult
func seedProject(_ store: CriaStore, serverId: Int = 1, title: String = "Inbox") throws -> String {
    let json = #"{"id": \#(serverId), "title": "\#(title)"}"#
    let localId = try store.upsertProjectFromServer(try decodeFixture(ProjectResponse.self, json), rawJSON: json)
    return try XCTUnwrap(localId)
}

func taskJSON(id: Int, projectId: Int = 1, title: String, done: Bool = false, position: Double? = nil,
              dueDate: String? = nil) -> String {
    let positionJSON = position.map { "\($0)" } ?? "null"
    let dueJSON = dueDate.map { "\"\($0)\"" } ?? "null"
    return """
    {"id": \(id), "project_id": \(projectId), "title": "\(title)", "done": \(done),
     "position": \(positionJSON), "due_date": \(dueJSON), "updated": "2026-06-09T10:00:00Z"}
    """
}

func outboxRows(_ store: CriaStore) throws -> [Row] {
    try store.database.writer.read { db in
        try Row.fetchAll(db, sql: "SELECT entity_type, entity_local_id, op FROM outbox ORDER BY id")
    }
}
