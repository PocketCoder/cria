import XCTest
@testable import CriaKit

final class SignedInFlagTests: XCTestCase {
    func testUnsetCountsAsSignedInAndSignOutTurnsItOff() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "SignedInFlagTests-\(UUID().uuidString)"))
        XCTAssertTrue(SignedInFlag.isSignedIn(defaults: defaults), "installs from before the flag stay working")
        SignedInFlag.set(false, defaults: defaults)
        XCTAssertFalse(SignedInFlag.isSignedIn(defaults: defaults))
        SignedInFlag.set(true, defaults: defaults)
        XCTAssertTrue(SignedInFlag.isSignedIn(defaults: defaults))
    }

    func testTodayLinkOpensToday() throws {
        let url = try XCTUnwrap(DeepLink.todayURL)
        XCTAssertNotNil(DeepLink(url: url))
    }
}
