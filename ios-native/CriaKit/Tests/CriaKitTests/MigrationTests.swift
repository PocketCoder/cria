import GRDB
import XCTest
@testable import CriaKit

final class MigrationTests: XCTestCase {
    func testBundleContainsTwentyMigrationsInOrder() throws {
        let sources = try CriaMigrations.sources()
        XCTAssertEqual(sources.count, 20)
        XCTAssertEqual(sources.first?.id, "001_initial")
        XCTAssertEqual(sources.last?.id, "020_fts_title_description_only")
    }

    func testFreshDatabaseReachesVersionTwenty() throws {
        let queue = try DatabaseQueue()
        try CriaMigrations.migrate(queue)
        let applied = try queue.read { database in
            try CriaMigrations.migrator().appliedMigrations(database)
        }
        XCTAssertEqual(applied.count, 20)
        XCTAssertEqual(applied.last, "020_fts_title_description_only")
    }

    /// 020: the search index follows title and description edits only.
    func testSearchTriggerFiresOnlyOnTitleOrDescription() throws {
        let queue = try DatabaseQueue()
        try CriaMigrations.migrate(queue)
        let sql = try queue.read { database in
            try String.fetchOne(database, sql: "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'tasks_fts_au'")
        }
        XCTAssertTrue(sql?.contains("AFTER UPDATE OF title, description ON tasks") ?? false)
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
