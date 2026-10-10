import GRDB
import XCTest
@testable import CriaKit

final class StoreTests: XCTestCase {
    func testConcurrentUserWritesDoNotInterleave() throws {
        let store = try makeStore()
        try store.database.writer.write { db in
            try db.execute(sql: "CREATE TABLE counter (n INTEGER NOT NULL)")
            try db.execute(sql: "INSERT INTO counter (n) VALUES (0)")
        }
        DispatchQueue.concurrentPerform(iterations: 50) { _ in
            do {
                // Read-modify-write inside one serialised transaction must not lose updates.
                try store.userWrite(announcing: []) { db in
                    let current = try Int.fetchOne(db, sql: "SELECT n FROM counter") ?? 0
                    try db.execute(sql: "UPDATE counter SET n = ?", arguments: [current + 1])
                }
            } catch {
                XCTFail("write failed: \(error)")
            }
        }
        let total = try store.database.writer.read { db in
            try Int.fetchOne(db, sql: "SELECT n FROM counter")
        }
        XCTAssertEqual(total, 50)
    }

    func testUserWriteAnnouncesButSyncUpsertDoesNot() async throws {
        let store = try makeStore()
        let stream = store.bus.subscribe()
        var iterator = stream.makeAsyncIterator()

        // A sync upsert must stay silent: the next event should be the user mutation's announcement.
        let projectId = try seedProject(store)
        try store.setProjectFavorite(localId: projectId, isFavorite: true)

        let first = await iterator.next()
        XCTAssertEqual(first, .projects)
    }
}
