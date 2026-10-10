import GRDB
import XCTest
@testable import CriaKit

final class CriaKitTests: XCTestCase {
    func testScaffoldVersionIsSet() {
        XCTAssertFalse(CriaKit.version.isEmpty)
    }

    func testGRDBLinksAgainstInMemoryDatabase() throws {
        let queue = try DatabaseQueue()
        let value = try queue.read { db in
            try Int.fetchOne(db, sql: "SELECT 1")
        }
        XCTAssertEqual(value, 1)
    }
}
