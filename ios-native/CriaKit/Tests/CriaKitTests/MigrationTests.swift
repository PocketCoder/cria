import GRDB
import XCTest
@testable import CriaKit

final class MigrationTests: XCTestCase {
    func testBundleContainsNineteenMigrationsInOrder() throws {
        let sources = try CriaMigrations.sources()
        XCTAssertEqual(sources.count, 19)
        XCTAssertEqual(sources.first?.id, "001_initial")
        XCTAssertEqual(sources.last?.id, "019_attachment_uploads")
    }

    func testFreshDatabaseReachesVersionNineteen() throws {
        let queue = try DatabaseQueue()
        try CriaMigrations.migrate(queue)
        let applied = try queue.read { database in
            try CriaMigrations.migrator().appliedMigrations(database)
        }
        XCTAssertEqual(applied.count, 19)
        XCTAssertEqual(applied.last, "019_attachment_uploads")
    }

    func testFTSTableExistsAfterMigration() throws {
        let queue = try DatabaseQueue()
        try CriaMigrations.migrate(queue)
        let exists = try queue.read { database in
            try Bool.fetchOne(
                database,
                sql: "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks_fts')"
            )
        }
        XCTAssertEqual(exists, true)
    }

    func testMigrateIsIdempotent() throws {
        let queue = try DatabaseQueue()
        try CriaMigrations.migrate(queue)
        XCTAssertNoThrow(try CriaMigrations.migrate(queue))
    }
}
