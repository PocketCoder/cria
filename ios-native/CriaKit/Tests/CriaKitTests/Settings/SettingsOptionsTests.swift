import XCTest
@testable import CriaKit

final class SettingsOptionsTests: XCTestCase {
    func testLanguageListMatchesTauri() {
        XCTAssertEqual(SettingsOptions.languages.count, 16)
        XCTAssertEqual(SettingsOptions.languages.first, LanguageOption(code: "en", label: "English"))
        XCTAssertTrue(SettingsOptions.languages.contains { $0.code == "pt_BR" })
    }

    func testUnknownServerLanguageIsKeptSelectable() {
        let options = SettingsOptions.languages(including: "xx")
        XCTAssertEqual(options.last, LanguageOption(code: "xx", label: "xx"))
        XCTAssertEqual(SettingsOptions.languages(including: "de").count, 16)
    }

    func testTimezonesGroupByRegion() {
        let groups = SettingsOptions.groupTimezones([
            "Europe/London", "America/New_York", "UTC", "Europe/Berlin", "America/Argentina/Buenos_Aires"
        ])
        XCTAssertEqual(groups.map(\.label), ["America", "Europe", "Other"])
        XCTAssertEqual(groups[0].items.map(\.label), ["Argentina/Buenos Aires", "New York"])
        XCTAssertEqual(groups[1].items.map(\.value), ["Europe/Berlin", "Europe/London"])
        XCTAssertEqual(groups[2].items.map(\.value), ["UTC"])
    }
}
