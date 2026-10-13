import GRDB
import XCTest
@testable import CriaKit

final class AttachmentMigrationTests: XCTestCase {
    // MARK: Migration 019 (migration-019.test.ts)

    private func rebuiltDatabase(upTo version: Int) throws -> DatabaseQueue {
        let queue = try DatabaseQueue()
        let sources = try CriaMigrations.sources().filter { (Int($0.id.prefix(3)) ?? 0) <= version }
        try queue.write { connection in
            for source in sources {
                try connection.execute(sql: source.sql)
            }
        }
        return queue
    }

    func testMigration019KeepsMirroredRowsGivingEachALocalId() throws {
        let queue = try rebuiltDatabase(upTo: 18)
        try queue.write { connection in
            for (serverId, name) in [(1, "a.pdf"), (2, "b.png")] {
                try connection.execute(sql: """
                    INSERT INTO task_attachments (task_local_id, server_id, file_id, file_name, file_size, mime, created_at)
                    VALUES ('t1', ?, ?, ?, 100, 'application/pdf', '2026-01-01T00:00:00Z')
                    """, arguments: [serverId, serverId * 10, name])
            }
        }
        let migration = try XCTUnwrap(try CriaMigrations.sources().first { $0.id.hasPrefix("019") })
        try queue.write { connection in
            try connection.execute(sql: migration.sql)
        }

        let rows = try queue.read { connection in
            try Row.fetchAll(connection, sql: "SELECT * FROM task_attachments ORDER BY server_id")
        }
        XCTAssertEqual(rows.count, 2)
        let first = rows[0]
        XCTAssertEqual(first["task_local_id"] as String?, "t1")
        XCTAssertEqual(first["server_id"] as Int?, 1)
        XCTAssertEqual(first["file_id"] as Int?, 10)
        XCTAssertEqual(first["file_name"] as String?, "a.pdf")
        XCTAssertEqual(first["file_size"] as Int?, 100)
        XCTAssertEqual(first["pending"] as Int?, 0)
        XCTAssertNil(first["bytes_path"] as String?)
        let firstId = try XCTUnwrap(first["local_id"] as String?)
        XCTAssertNotEqual(firstId, rows[1]["local_id"] as String?)
    }

    func testMigration019AllowsPendingRowsWithoutServerIdButKeepsServerIdsUnique() throws {
        let queue = try rebuiltDatabase(upTo: 19)
        func insert(_ localId: String?, _ serverId: Int?, _ pending: Int, _ bytesPath: String?) throws {
            try queue.write { connection in
                try connection.execute(sql: """
                    INSERT INTO task_attachments (local_id, task_local_id, server_id, pending, bytes_path)
                    VALUES (?, 't1', ?, ?, ?)
                    """, arguments: [localId, serverId, pending, bytesPath])
            }
        }
        try insert("p1", nil, 1, "p1")
        try insert("p2", nil, 1, "p2")
        try insert("m1", 5, 0, nil)
        XCTAssertThrowsError(try insert("m2", 5, 0, nil)) { error in
            XCTAssertTrue(String(describing: error).contains("UNIQUE"))
        }
        XCTAssertThrowsError(try insert(nil, 6, 0, nil)) { error in
            XCTAssertTrue(String(describing: error).contains("NOT NULL"))
        }
        let count = try queue.read { connection in
            try Int.fetchOne(connection, sql: "SELECT COUNT(*) FROM task_attachments")
        }
        XCTAssertEqual(count, 3)
    }
}
