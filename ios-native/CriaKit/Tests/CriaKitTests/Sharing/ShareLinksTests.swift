import XCTest
@testable import CriaKit

final class ShareLinksTests: XCTestCase {
    func testParsesFullShareUrls() {
        XCTAssertEqual(ShareLinks.parseInput("https://vk.example/share/abc123/auth"), "abc123")
        XCTAssertEqual(ShareLinks.parseInput("https://vk.example/share/abc123"), "abc123")
        XCTAssertEqual(ShareLinks.parseInput("https://vk.example/share/abc123/auth?x=1"), "abc123")
        XCTAssertEqual(ShareLinks.parseInput("https://vk.example/share/abc123#top"), "abc123")
    }

    func testParsesBareHashAndTrims() {
        XCTAssertEqual(ShareLinks.parseInput("  Hash9  "), "Hash9")
    }

    func testRejectsEmptyAndNonHashInput() {
        XCTAssertNil(ShareLinks.parseInput(""))
        XCTAssertNil(ShareLinks.parseInput("   "))
        XCTAssertNil(ShareLinks.parseInput("http"))
        XCTAssertNil(ShareLinks.parseInput("HTTPS"))
        XCTAssertNil(ShareLinks.parseInput("not a hash"))
        XCTAssertNil(ShareLinks.parseInput("https://vk.example/projects/1"))
    }

    func testUrlPrefersFrontendUrl() {
        let url = ShareLinks.url(serverURL: "https://api.example/api/v1", frontendURL: " https://app.example/ ", hash: "h1")
        XCTAssertEqual(url, "https://app.example/share/h1/auth")
    }

    func testUrlDerivesFromServerUrl() {
        XCTAssertEqual(ShareLinks.url(serverURL: "https://vk.example/api/v1/", frontendURL: nil, hash: "h1"),
                       "https://vk.example/share/h1/auth")
        XCTAssertEqual(ShareLinks.url(serverURL: "https://vk.example/", frontendURL: "", hash: "h1"),
                       "https://vk.example/share/h1/auth")
    }
}
