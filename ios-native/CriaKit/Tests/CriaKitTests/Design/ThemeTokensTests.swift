import XCTest
@testable import CriaKit

final class ThemeTokensTests: XCTestCase {
    func testWhiteAndBlack() {
        let white = ColorSpec.oklch(100, 0, 0).rgb
        XCTAssertEqual(white.red, 1, accuracy: 0.001)
        XCTAssertEqual(white.green, 1, accuracy: 0.001)
        XCTAssertEqual(white.blue, 1, accuracy: 0.001)
        let black = ColorSpec.oklch(0, 0, 0).rgb
        XCTAssertEqual(black, RGBColor(red: 0, green: 0, blue: 0))
    }

    func testMidGreyMatchesReference() {
        let grey = ColorSpec.oklch(50, 0, 0).rgb
        XCTAssertEqual(grey.red, 0.3885, accuracy: 0.002)
        XCTAssertEqual(grey.green, grey.red, accuracy: 0.0001)
    }

    func testHexSpec() {
        let rgb = ColorSpec.hex(0x643B9F).rgb
        XCTAssertEqual(rgb.red, 100.0 / 255, accuracy: 0.0001)
        XCTAssertEqual(rgb.green, 59.0 / 255, accuracy: 0.0001)
        XCTAssertEqual(rgb.blue, 159.0 / 255, accuracy: 0.0001)
    }

    func testEveryTokenIsDefined() {
        let fallback = ThemePair(light: .hex(0), dark: .hex(0xFFFFFF))
        for token in ThemeToken.allCases {
            XCTAssertNotEqual(token.pair, fallback, "\(token) missing from the table")
        }
        XCTAssertNotEqual(ThemeToken.background.pair.light, ThemeToken.background.pair.dark)
        XCTAssertEqual(ThemeToken.primary.pair.light, .hex(0x643B9F))
    }

    func testDarkBackgroundIsDarkerThanLight() {
        let pair = ThemeToken.background.pair
        XCTAssertLessThan(pair.dark.rgb.red, pair.light.rgb.red)
    }

    func testChromaticColoursStayInGamut() {
        for token in ThemeToken.allCases {
            for spec in [token.pair.light, token.pair.dark] {
                let rgb = spec.rgb
                for channel in [rgb.red, rgb.green, rgb.blue] {
                    XCTAssertTrue((0...1).contains(channel), "\(token) out of gamut")
                }
            }
        }
    }

    func testPriorityScale() {
        XCTAssertNil(ThemeToken.priority(0))
        XCTAssertEqual(ThemeToken.priority(1), .priorityLow)
        XCTAssertEqual(ThemeToken.priority(5), .priorityCritical)
        XCTAssertNil(ThemeToken.priority(6))
    }

    /// Handoff: grouped light is about #F4F3F0, cell dark about #1C1A21.
    func testNativeSurfacesMatchHandoff() {
        let grouped = ThemeToken.grouped.pair.light.rgb
        XCTAssertEqual(grouped.red * 255, 244, accuracy: 2)
        XCTAssertEqual(grouped.blue * 255, 240, accuracy: 2)
        let cell = ThemeToken.cell.pair.dark.rgb
        XCTAssertEqual(cell.red * 255, 28, accuracy: 2)
        XCTAssertEqual(cell.blue * 255, 33, accuracy: 2)
    }
}
