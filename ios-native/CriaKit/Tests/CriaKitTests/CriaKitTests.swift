import GRDB
import XCTest
@testable import CriaKit

final class CriaKitTests: XCTestCase {
    func testScaffoldVersionIsSet() {
        XCTAssertFalse(CriaKit.version.isEmpty)
    }

    func testGRDBLinksAgainstInMemoryDatabase() throws {
        let queue = try DatabaseQueue()
        let value = try queue.read { database in
            try Int.fetchOne(database, sql: "SELECT 1")
        }
        XCTAssertEqual(value, 1)
    }
}
