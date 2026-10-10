import XCTest
@testable import CriaKit

final class CriaKitTests: XCTestCase {
    func testScaffoldVersionIsSet() {
        XCTAssertFalse(CriaKit.version.isEmpty)
    }
}
